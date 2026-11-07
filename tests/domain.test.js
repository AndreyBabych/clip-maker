import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectSchema,sceneSchema} from '../domain.js';
const scene={id:'163c1297-4fab-49bb-a417-6b51b60cd6b2',title:'Opening',start:0,end:5,description:'A quiet room',prompt:'Wide shot',approved:false};
test('accepts precise scene boundaries',()=>assert.equal(sceneSchema.parse({...scene,end:5.04}).end,5.04));
test('rejects reversed or zero length scenes',()=>{for(const end of [0,-1])assert.equal(sceneSchema.safeParse({...scene,end}).success,false)});
test('rejects invalid timestamps and missing approval state',()=>{assert.equal(sceneSchema.safeParse({...scene,start:NaN}).success,false);assert.equal(sceneSchema.safeParse({...scene,approved:undefined}).success,false)});
test('validates project and strips unknown storage fields',()=>{const d=projectSchema.parse({title:'Film',idea:'Idea',ratio:'16:9',archived:false,scenes:[scene],characters:[],locations:[],secret:'bad'});assert.equal(d.secret,undefined)});
