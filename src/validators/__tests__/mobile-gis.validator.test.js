'use strict';
const v=require('../mobile-gis.validator');
describe('mobile GIS validator',()=>{
 test('accepts bounded tile and line measurement',()=>{expect(v.tileParams.validate({layerId:1,z:12,x:3267,y:'1820.mvt'}).error).toBeUndefined();expect(v.measureBody.validate({geometry:{type:'LineString',coordinates:[[107.3,21],[107.31,21.01]]}}).error).toBeUndefined();});
 test('rejects point measurement, open polygon, out-of-area and oversized radius',()=>{expect(v.measureBody.validate({geometry:{type:'Point',coordinates:[107.3,21]}}).error).toBeDefined();expect(v.measureBody.validate({geometry:{type:'Polygon',coordinates:[[[107.3,21],[107.31,21],[107.31,21.01],[107.3,21.01]]]}}).error).toBeDefined();expect(v.draftBody.validate({title:'x',geometry:{type:'Point',coordinates:[1,1]}}).error).toBeDefined();expect(v.nearbyQuery.validate({longitude:107.3,latitude:21,radiusMeters:2001}).error).toBeDefined();});
});