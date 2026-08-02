'use strict';

const escapeXml = (value) =>
    String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
const text = (name, value) =>
    value === undefined || value === null || value === ''
        ? ''
        : `<${name}><gco:CharacterString>${escapeXml(value)}</gco:CharacterString></${name}>`;
const code = (name, list, value) =>
    `<${name}><gmd:${list} codeList="http://standards.iso.org/iso/19139/resources/gmxCodelists.xml#${list}" codeListValue="${escapeXml(value)}">${escapeXml(value)}</gmd:${list}></${name}>`;
const decimal = (name, value) => `<${name}><gco:Decimal>${Number(value)}</gco:Decimal></${name}>`;
const date = (name, value) =>
    `<${name}><gco:Date>${escapeXml(String(value).slice(0, 10))}</gco:Date></${name}>`;
const contactXml = (contact) => `<gmd:contact><gmd:CI_ResponsibleParty>
${text('gmd:organisationName', contact.organizationName)}
${contact.email ? `<gmd:contactInfo><gmd:CI_Contact><gmd:address><gmd:CI_Address>${text('gmd:electronicMailAddress', contact.email)}</gmd:CI_Address></gmd:address></gmd:CI_Contact></gmd:contactInfo>` : ''}
${code('gmd:role', 'CI_RoleCode', contact.role)}
</gmd:CI_ResponsibleParty></gmd:contact>`;

const toIso19139Xml = (layer, profile) => {
    const i = profile.identification;
    const e = i.extent;
    const c = profile.constraints;
    const q = profile.dataQuality;
    const d = profile.distribution;
    const keywords = i.keywords
        .map(
            (value) =>
                `<gmd:keyword><gco:CharacterString>${escapeXml(value)}</gco:CharacterString></gmd:keyword>`,
        )
        .join('');
    const topics = i.topicCategories
        .map(
            (value) =>
                `<gmd:topicCategory><gmd:MD_TopicCategoryCode>${escapeXml(value)}</gmd:MD_TopicCategoryCode></gmd:topicCategory>`,
        )
        .join('');
    const resources = d.onlineResources
        .map(
            (resource) => `<gmd:onLine><gmd:CI_OnlineResource>
<gmd:linkage><gmd:URL>${escapeXml(resource.url)}</gmd:URL></gmd:linkage>
${text('gmd:protocol', resource.protocol)}${text('gmd:name', resource.name)}${text('gmd:description', resource.description)}
</gmd:CI_OnlineResource></gmd:onLine>`,
        )
        .join('');
    return `<?xml version="1.0" encoding="UTF-8"?>
<gmd:MD_Metadata xmlns:gmd="http://www.isotc211.org/2005/gmd" xmlns:gco="http://www.isotc211.org/2005/gco" xmlns:gml="http://www.opengis.net/gml/3.2" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.isotc211.org/2005/gmd http://schemas.opengis.net/iso/19139/20070417/gmd/gmd.xsd">
${text('gmd:fileIdentifier', profile.metadataIdentifier)}
${text('gmd:parentIdentifier', layer.code)}
${code('gmd:language', 'LanguageCode', profile.language)}
${code('gmd:characterSet', 'MD_CharacterSetCode', profile.characterSet)}
${code('gmd:hierarchyLevel', 'MD_ScopeCode', profile.hierarchyLevel)}
${contactXml(profile.contact)}
${date('gmd:dateStamp', profile.dateStamp)}
${text('gmd:metadataStandardName', 'TCVN 12687:2019 / ISO 19115')}
${text('gmd:metadataStandardVersion', profile.standardVersion)}
<gmd:referenceSystemInfo><gmd:MD_ReferenceSystem><gmd:referenceSystemIdentifier><gmd:RS_Identifier>${text('gmd:code', profile.referenceSystem.code)}${text('gmd:codeSpace', profile.referenceSystem.codeSpace)}</gmd:RS_Identifier></gmd:referenceSystemIdentifier></gmd:MD_ReferenceSystem></gmd:referenceSystemInfo>
<gmd:identificationInfo><gmd:MD_DataIdentification>
<gmd:citation><gmd:CI_Citation>${text('gmd:title', i.title)}<gmd:date><gmd:CI_Date>${date('gmd:date', i.citationDate)}${code('gmd:dateType', 'CI_DateTypeCode', i.citationDateType)}</gmd:CI_Date></gmd:date></gmd:CI_Citation></gmd:citation>
${text('gmd:abstract', i.abstract)}${text('gmd:purpose', i.purpose)}
${code('gmd:status', 'MD_ProgressCode', i.status)}
<gmd:descriptiveKeywords><gmd:MD_Keywords>${keywords}</gmd:MD_Keywords></gmd:descriptiveKeywords>
${topics}${code('gmd:language', 'LanguageCode', i.language)}${code('gmd:characterSet', 'MD_CharacterSetCode', i.characterSet)}
<gmd:extent><gmd:EX_Extent>${text('gmd:description', e.description)}<gmd:geographicElement><gmd:EX_GeographicBoundingBox>
${decimal('gmd:westBoundLongitude', e.westBoundLongitude)}${decimal('gmd:eastBoundLongitude', e.eastBoundLongitude)}${decimal('gmd:southBoundLatitude', e.southBoundLatitude)}${decimal('gmd:northBoundLatitude', e.northBoundLatitude)}
</gmd:EX_GeographicBoundingBox></gmd:geographicElement>${e.begin || e.end ? `<gmd:temporalElement><gmd:EX_TemporalExtent><gmd:extent><gml:TimePeriod gml:id="extent-time"><gml:beginPosition>${escapeXml(e.begin || '')}</gml:beginPosition><gml:endPosition>${escapeXml(e.end || '')}</gml:endPosition></gml:TimePeriod></gmd:extent></gmd:EX_TemporalExtent></gmd:temporalElement>` : ''}</gmd:EX_Extent></gmd:extent>
</gmd:MD_DataIdentification></gmd:identificationInfo>
<gmd:metadataConstraints><gmd:MD_LegalConstraints>${code('gmd:accessConstraints', 'MD_RestrictionCode', c.accessConstraints)}${code('gmd:useConstraints', 'MD_RestrictionCode', c.useConstraints)}${text('gmd:otherConstraints', c.otherConstraints)}</gmd:MD_LegalConstraints></gmd:metadataConstraints>
<gmd:dataQualityInfo><gmd:DQ_DataQuality><gmd:scope><gmd:DQ_Scope>${code('gmd:level', 'MD_ScopeCode', q.scope)}</gmd:DQ_Scope></gmd:scope><gmd:lineage><gmd:LI_Lineage>${text('gmd:statement', q.lineage)}</gmd:LI_Lineage></gmd:lineage></gmd:DQ_DataQuality></gmd:dataQualityInfo>
<gmd:distributionInfo><gmd:MD_Distribution><gmd:distributionFormat><gmd:MD_Format>${text('gmd:name', d.formatName)}${text('gmd:version', d.formatVersion)}</gmd:MD_Format></gmd:distributionFormat><gmd:transferOptions><gmd:MD_DigitalTransferOptions>${resources}</gmd:MD_DigitalTransferOptions></gmd:transferOptions></gmd:MD_Distribution></gmd:distributionInfo>
</gmd:MD_Metadata>\n`;
};

module.exports = { escapeXml, toIso19139Xml };
