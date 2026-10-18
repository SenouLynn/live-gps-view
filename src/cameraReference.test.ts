import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as C from 'cesium';
import { cameraReferencePosition } from './cameraReference.ts';
const direction = new C.Cartesian3(0,0,-1), right = new C.Cartesian3(1,0,0), up = new C.Cartesian3(0,1,0);
const project = (forward: C.Cartesian3) => cameraReferencePosition(forward,direction,right,up,1000,600,Math.PI/2);
test('forward reference centers when aligned and moves opposite a camera pan', () => {
  assert.deepEqual(project(direction), { x:500,y:300,edge:false });
  const left = project(C.Cartesian3.normalize(new C.Cartesian3(-.5,0,-1),new C.Cartesian3()));
  assert.ok(Math.abs(left.x-350)<1e-8); assert.equal(left.y,300); assert.equal(left.edge,false);
  const below = project(C.Cartesian3.normalize(new C.Cartesian3(0,-.5,-1),new C.Cartesian3()));
  assert.ok(Math.abs(below.y-450)<1e-8);
});
test('offscreen and rear references stay bounded without flipping to the screen center', () => {
  for (const forward of [new C.Cartesian3(1,0,0),new C.Cartesian3(0,0,1),new C.Cartesian3(1,1,1)]) {
    const p=project(C.Cartesian3.normalize(forward,new C.Cartesian3()));
    assert.equal(p.edge,true);assert.ok(p.x>=32&&p.x<=968);assert.ok(p.y>=32&&p.y<=568);
    assert.ok(p.x!==500||p.y!==300);
  }
});
