'use strict';
jest.mock('../../repositories/spatial-statistics.repository');
jest.mock('../../utils/systemLogger.util',()=>({logInfo:jest.fn()}));
const repository=require('../../repositories/spatial-statistics.repository');
const service=require('../spatial-statistics.service');
const actor={id:7,role:'so_tnmt',orgId:2,lang:'vi',permissions:{stats:{view:true},spatial:{analyze:true}}};
describe('Sprint 7 statistics service',()=>{
 beforeEach(()=>jest.clearAllMocks());
 test('denies stats read without DB permission',()=>{expect(()=>service.listSources({}, {...actor,permissions:{stats:{view:false}}})).toThrow(expect.objectContaining({status:403}));expect(repository.list).not.toHaveBeenCalled();});
 test('passes role to layer ACL queries',async()=>{repository.list.mockResolvedValue([]);await expect(service.listSources({},actor)).resolves.toEqual([]);expect(repository.list).toHaveBeenCalledWith({},'so_tnmt');});
 test('denies analyze mutations without permission',async()=>{await expect(service.createSource({}, {...actor,permissions:{stats:{view:true},spatial:{analyze:false}}})).rejects.toMatchObject({status:403});expect(repository.create).not.toHaveBeenCalled();});
 test('groups area rows into time series',async()=>{repository.areas.mockResolvedValue([{observed_year:2026,observed_at:null,administrative_code:'P1',administrative_name:'Phường 1',label:'flood',area_m2:'10',area_ha:'0.001',feature_count:'1'},{observed_year:2026,observed_at:null,administrative_code:'P1',administrative_name:'Phường 1',label:'flood',area_m2:'20',area_ha:'0.002',feature_count:'2'}]);await expect(service.timeSeries({type:'flood'},actor)).resolves.toEqual([expect.objectContaining({year:2026,areaM2:30,featureCount:3})]);});
});