'use strict';
const db = require('../configs/database');
const webMap = require('./web-map.repository');
const tableFor = (layer) => webMap.qid(layer.table_name);
const rebuild = async (layer, input, actor) => {
    const client = await db.getClient(),
        table = tableFor(layer),
        id = webMap.qid(webMap.idFieldFor(layer), webMap.FIELD);
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(9251,$1::integer)', [layer.id]);
        await client.query("SET LOCAL statement_timeout='30s'");
        const {
            rows: [network],
        } = await client.query(
            `INSERT INTO gis.routing_networks(layer_id,directed,snap_tolerance_m,status,created_by,updated_by) VALUES($1,$2,$3,'building',$4,$4) ON CONFLICT(layer_id) DO UPDATE SET directed=EXCLUDED.directed,snap_tolerance_m=EXCLUDED.snap_tolerance_m,status='building',updated_by=EXCLUDED.updated_by,evidence='{}' RETURNING *`,
            [layer.id, input.directed, input.snapToleranceMeters, actor.id],
        );
        await client.query('DELETE FROM gis.routing_vertices WHERE network_id=$1', [network.id]);
        const segmentSql = `SELECT ${id}::text source_feature_id,COALESCE((d).path[1],1)::int segment_index,ST_Force2D((d).geom)::geometry(LineString,4326) geom FROM gis.${table} t CROSS JOIN LATERAL ST_Dump(ST_LineMerge(ST_Transform(t.geom,4326))) d WHERE t.geom IS NOT NULL AND NOT ST_IsEmpty(t.geom)`;
        await client.query(
            `WITH segments AS(${segmentSql}),points AS(SELECT ST_StartPoint(geom) geom FROM segments UNION ALL SELECT ST_EndPoint(geom) FROM segments),unique_points AS(SELECT DISTINCT ST_SnapToGrid(ST_Transform(geom,5899),$2) snapped FROM points),numbered AS(SELECT ROW_NUMBER() OVER(ORDER BY ST_X(snapped),ST_Y(snapped))::bigint id,ST_Transform(snapped,4326)::geometry(Point,4326) geom FROM unique_points) INSERT INTO gis.routing_vertices(network_id,id,geom) SELECT $1,id,geom FROM numbered`,
            [network.id, input.snapToleranceMeters],
        );
        await client.query(
            `WITH segments AS(${segmentSql}),prepared AS(SELECT source_feature_id,segment_index,geom,ST_SnapToGrid(ST_Transform(ST_StartPoint(geom),5899),$2) a,ST_SnapToGrid(ST_Transform(ST_EndPoint(geom),5899),$2) b FROM segments) INSERT INTO gis.routing_edges(network_id,source_feature_id,segment_index,source,target,cost,reverse_cost,geom) SELECT $1,p.source_feature_id,p.segment_index,a.id,b.id,ST_Length(ST_Transform(p.geom,5899)),CASE WHEN $3 THEN -1 ELSE ST_Length(ST_Transform(p.geom,5899)) END,p.geom FROM prepared p JOIN gis.routing_vertices a ON a.network_id=$1 AND ST_DWithin(ST_Transform(a.geom,5899),p.a,$2/2) JOIN gis.routing_vertices b ON b.network_id=$1 AND ST_DWithin(ST_Transform(b.geom,5899),p.b,$2/2) WHERE NOT ST_Equals(p.a,p.b)`,
            [network.id, input.snapToleranceMeters, input.directed],
        );
        const evidence = await topologyEvidence(network.id, client);
        const status =
            evidence.edgeCount > 0 &&
            evidence.components === 1 &&
            evidence.isolatedVertices === 0 &&
            evidence.unNodedCrossings === 0
                ? 'ready'
                : 'invalid';
        const {
            rows: [row],
        } = await client.query(
            `UPDATE gis.routing_networks SET status=$2,evidence=$3,topology_version=topology_version+1,built_at=NOW(),updated_by=$4 WHERE id=$1 RETURNING *`,
            [network.id, status, evidence, actor.id],
        );
        await client.query('COMMIT');
        return row;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};
const topologyEvidence = async (networkId, client = db) => {
    const edgeSql = `SELECT id,source,target,cost,reverse_cost FROM gis.routing_edges WHERE network_id=${Number(networkId)}`;
    const {
        rows: [row],
    } = await client.query(
        `WITH degree AS(SELECT id,COUNT(e.edge_id)::int degree FROM gis.routing_vertices v LEFT JOIN LATERAL(SELECT id edge_id FROM gis.routing_edges WHERE network_id=$1 AND (source=v.id OR target=v.id)) e ON true WHERE v.network_id=$1 GROUP BY id),components AS(SELECT COUNT(DISTINCT component)::int n FROM pgr_connectedComponents($2)),crossings AS(SELECT COUNT(*)::int n FROM gis.routing_edges a JOIN gis.routing_edges b ON a.network_id=b.network_id AND a.id<b.id WHERE a.network_id=$1 AND (ST_Crosses(a.geom,b.geom) OR (ST_Touches(a.geom,b.geom) AND NOT (ST_Equals(ST_StartPoint(a.geom),ST_StartPoint(b.geom)) OR ST_Equals(ST_StartPoint(a.geom),ST_EndPoint(b.geom)) OR ST_Equals(ST_EndPoint(a.geom),ST_StartPoint(b.geom)) OR ST_Equals(ST_EndPoint(a.geom),ST_EndPoint(b.geom)))))) SELECT (SELECT COUNT(*)::int FROM gis.routing_edges WHERE network_id=$1) edge_count,(SELECT COUNT(*)::int FROM gis.routing_vertices WHERE network_id=$1) vertex_count,(SELECT COUNT(*)::int FROM degree WHERE degree=0) isolated_vertices,(SELECT COUNT(*)::int FROM degree WHERE degree=1) dead_end_vertices,COALESCE((SELECT n FROM components),0) components,(SELECT n FROM crossings) un_noded_crossings`,
        [networkId, edgeSql],
    );
    return {
        edgeCount: row.edge_count,
        vertexCount: row.vertex_count,
        isolatedVertices: row.isolated_vertices,
        deadEndVertices: row.dead_end_vertices,
        components: row.components,
        unNodedCrossings: row.un_noded_crossings,
        analyzer: 'postgis+pgr_connectedComponents',
        pgrAnalyzeGraph: 'deprecated-in-pgrouting-3.8',
    };
};
const findNetwork = async (layerId) => {
    const {
        rows: [row],
    } = await db.query('SELECT * FROM gis.routing_networks WHERE layer_id=$1', [layerId]);
    return row || null;
};
const shortest = async (network, input) => {
    const {
        rows: [snap],
    } = await db.query(
        `SELECT (SELECT id FROM gis.routing_vertices WHERE network_id=$1 AND ST_DWithin(ST_Transform(geom,5899),ST_Transform(ST_SetSRID(ST_MakePoint($2,$3),4326),5899),$6) ORDER BY geom <-> ST_SetSRID(ST_MakePoint($2,$3),4326) LIMIT 1) start_id,(SELECT id FROM gis.routing_vertices WHERE network_id=$1 AND ST_DWithin(ST_Transform(geom,5899),ST_Transform(ST_SetSRID(ST_MakePoint($4,$5),4326),5899),$6) ORDER BY geom <-> ST_SetSRID(ST_MakePoint($4,$5),4326) LIMIT 1) end_id`,
        [
            network.id,
            input.start[0],
            input.start[1],
            input.end[0],
            input.end[1],
            input.snapRadiusMeters,
        ],
    );
    if (!snap.start_id || !snap.end_id) {
        return null;
    }
    const edgeSql = `SELECT id,source,target,cost,reverse_cost FROM gis.routing_edges WHERE network_id=${Number(network.id)}`;
    const {
        rows: [route],
    } = await db.query(
        `WITH path AS(SELECT * FROM pgr_dijkstra($1,$2::bigint,$3::bigint,$4)),segments AS(SELECT p.path_seq,p.node,p.edge,p.agg_cost,CASE WHEN p.node=e.source THEN e.geom ELSE ST_Reverse(e.geom) END geom FROM path p LEFT JOIN gis.routing_edges e ON e.id=p.edge AND e.network_id=$5),shape AS(SELECT ST_LineMerge(ST_Collect(geom ORDER BY path_seq)) geom FROM segments WHERE edge<>-1) SELECT ROUND((SELECT MAX(agg_cost) FROM segments)::numeric,2) distance_m,ST_AsGeoJSON((SELECT geom FROM shape),6)::jsonb geometry,(SELECT ST_AsGeoJSON(geom,6)::jsonb FROM gis.routing_vertices WHERE network_id=$5 AND id=$2) snapped_start,(SELECT ST_AsGeoJSON(geom,6)::jsonb FROM gis.routing_vertices WHERE network_id=$5 AND id=$3) snapped_end`,
        [edgeSql, snap.start_id, snap.end_id, network.directed, network.id],
    );
    return route?.geometry ? route : null;
};
module.exports = { rebuild, topologyEvidence, findNetwork, shortest };
