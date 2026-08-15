<?xml version="1.0" encoding="UTF-8"?>
<!--
  SLD Style: forecast_flood_depth
  Độ sâu ngập dự báo (m) — Float32, chỉ có giá trị trong vùng dự báo ngập

  Thang màu gradient từ nông → sâu:
    0.0 m  → trắng xanh nhạt  #E3F2FD
    0.5 m  → xanh dương nhạt  #64B5F6
    1.0 m  → xanh dương       #1E88E5
    2.0 m  → xanh dương đậm   #1565C0
    3.0 m  → xanh tím         #4527A0
    5.0 m+ → tím đậm          #1A237E

  Pixel ngoài mask (NoData) → trong suốt.
-->
<StyledLayerDescriptor version="1.0.0"
    xsi:schemaLocation="http://www.opengis.net/sld StyledLayerDescriptor.xsd"
    xmlns="http://www.opengis.net/sld"
    xmlns:ogc="http://www.opengis.net/ogc"
    xmlns:xlink="http://www.w3.org/1999/xlink"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <NamedLayer>
    <Name>forecast_flood_depth</Name>
    <UserStyle>
      <Title>Độ sâu ngập dự báo (m)</Title>
      <Abstract>
        Độ sâu ngập ước tính = h_eff − HAND (m), chỉ trong vùng dự báo ngập.
        Đây là KỊ CH BẢN, không phải đo thực tế.
      </Abstract>
      <FeatureTypeStyle>
        <Rule>
          <RasterSymbolizer>
            <Opacity>0.82</Opacity>
            <ColorMap type="ramp">
              <ColorMapEntry color="#E3F2FD" quantity="0.0"  label="0 m (mặt nước)" opacity="0.6"/>
              <ColorMapEntry color="#64B5F6" quantity="0.5"  label="0.5 m"          opacity="0.75"/>
              <ColorMapEntry color="#1E88E5" quantity="1.0"  label="1.0 m"          opacity="0.82"/>
              <ColorMapEntry color="#1565C0" quantity="2.0"  label="2.0 m"          opacity="0.88"/>
              <ColorMapEntry color="#4527A0" quantity="3.0"  label="3.0 m"          opacity="0.90"/>
              <ColorMapEntry color="#1A237E" quantity="5.0"  label="≥ 5 m (sâu)"   opacity="0.95"/>
            </ColorMap>
          </RasterSymbolizer>
        </Rule>
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
