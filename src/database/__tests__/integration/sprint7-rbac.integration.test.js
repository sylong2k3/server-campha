'use strict';
if(process.env.DB_NAME!=='campha_test'){throw new Error('Sprint 7 RBAC integration only runs on campha_test');}
const db=require('../../../configs/database');
describe('Sprint 7 role matrix',()=>{
 afterAll(async()=>{db.stopPoolMonitor();await db.pool.end();});
 test('citizen can view statistics but cannot export or analyze',async()=>{const {rows:[role]}=await db.query(`SELECT permissions FROM auth.roles WHERE code='citizen'`);expect(role.permissions.stats.view).toBe(true);expect(role.permissions.stats.export).not.toBe(true);expect(role.permissions.spatial?.analyze).not.toBe(true);});
 test.each(['system_admin','ubnd_tp','so_tnmt','so_xd'])('%s can view/export/analyze',async(code)=>{const {rows:[role]}=await db.query('SELECT permissions FROM auth.roles WHERE code=$1',[code]);expect(role.permissions.stats).toMatchObject({view:true,export:true});expect(role.permissions.spatial).toMatchObject({analyze:true});});
});