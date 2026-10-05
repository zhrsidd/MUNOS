import test from 'node:test';
import assert from 'node:assert/strict';
import {flatten,parseCommitteeList,planDrive,renderTree,safeFolderName,validateCommittees} from '../lib/drive/plan';
test('drive plan: minimal tree with stable keys, deterministic and duplicate-free',()=>{
 const plan=planDrive('DCMUN XVIII',[{code:'GA1',name:'General Assembly First Committee'},{code:'who'}]);
 const folders=flatten(plan);
 assert.equal(folders.length,1+1+2*4+2,'root, Committees, 2 committees × (1+3), Conference-wide, System Backups');
 assert.deepEqual(folders.filter(f=>f.parentKey==='committee:GA1').map(f=>f.key),['committee:GA1:approval','committee:GA1:snapshots','committee:GA1:exports']);
 assert.equal(new Set(folders.map(f=>f.key)).size,folders.length,'keys are unique');
 assert.equal(folders.find(f=>f.key==='committee:WHO')!.name,'WHO','codes normalized');
 assert.deepEqual(flatten(planDrive('DCMUN XVIII',[{code:'GA1'},{code:'WHO'}])).map(f=>f.key),flatten(planDrive('DCMUN XVIII',[{code:'GA1'},{code:'WHO'}])).map(f=>f.key),'same input, same plan');
 assert.match(renderTree(plan),/└── System Backups$/);
});
test('drive plan: input validation and safe names',()=>{
 assert.deepEqual(validateCommittees([{code:'GA1'},{code:'ga1'}]),['Committee code GA1 appears twice.']);
 assert.equal(validateCommittees([{code:''}]).length,1);
 assert.equal(validateCommittees([{code:'GA1/../x'}]).length,1);
 assert.throws(()=>planDrive('  ',[{code:'GA1'}]),/Conference name/);
 assert.equal(safeFolderName('A/B\\C\u0007  D'),'A-B-C D');
 assert.deepEqual(parseCommitteeList('GA1, WHO ,SC'),[{code:'GA1'},{code:'WHO'},{code:'SC'}]);
 assert.deepEqual(parseCommitteeList('# list\nGA1 | General Assembly\nSC,Security Council\n'),[{code:'GA1',name:'General Assembly'},{code:'SC',name:'Security Council'}]);
});
