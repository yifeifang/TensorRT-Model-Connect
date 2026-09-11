'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {decodeGeometry,geometryPresentation,geometryPly}=require('../geometry-data');
const encoding={depthEncoding:'float32le',pointsEncoding:'float32le-xyz',maskEncoding:'u8-validity',invalidValue:'+Infinity'};
const f32=values=>{const b=Buffer.alloc(values.length*4);values.forEach((v,i)=>b.writeFloatLE(v,i*4));return b.toString('base64');};
function fixture(){
  return{asset:{width:2,height:2,rgba:Buffer.from([255,0,0,255,0,255,0,255,0,0,255,255,0,0,0,0])},result:{...encoding,width:2,height:2,depthBase64:f32([1,2,3,Infinity]),pointsBase64:f32([0,0,1,1,0,2,0,1,3,Infinity,Infinity,Infinity]),maskBase64:Buffer.from([1,1,1,0]).toString('base64'),intrinsics:[1,0,.5,0,1,.5,0,0,1],validPixelCount:3}};
}
test('geometry presentation and PLY preserve only actual valid model points and original colors',()=>{
  const {asset,result}=fixture(),p=geometryPresentation(result,asset);
  assert.deepEqual(p.geometryPreview.points,[0,0,1,1,0,2,0,1,3]);assert.deepEqual(p.geometryPreview.colors,[255,0,0,0,255,0,0,0,255]);
  assert.equal(p.geometryPreview.validPixelCount,3);assert.equal(p.geometryPreview.displayedPointCount,3);
  const bytes=Buffer.from(p.depthDataUrl.split(',')[1],'base64');assert.equal(bytes.readUInt32BE(16),2);assert.equal(bytes.readUInt32BE(20),2);
  const ply=geometryPly(result,asset);assert.match(ply,/element vertex 3/);assert.match(ply,/0 0 1 255 0 0\n1 0 2 0 255 0\n0 1 3 0 0 255\n$/);assert.doesNotMatch(ply,/NaN/);
});
test('malformed or non-finite valid geometry is rejected instead of rendered',()=>{
  const {asset,result}=fixture();
  for(const bad of [{...result,width:3},{...result,depthBase64:'AA=='},{...result,maskBase64:Buffer.from([1,1,1,1]).toString('base64')},{...result,maskBase64:Buffer.from([255,1,1,0]).toString('base64')},{...result,intrinsics:[NaN,...result.intrinsics.slice(1)]},{...result,validPixelCount:4},{...result,depthEncoding:'float64be'},{...result,pointsBase64:f32([0,0,2,1,0,2,0,1,3,Infinity,Infinity,Infinity])}])assert.throws(()=>decodeGeometry(bad,asset));
  assert.throws(()=>decodeGeometry({...result,depthBase64:f32(Array(4).fill(Infinity)),pointsBase64:f32(Array(12).fill(Infinity)),maskBase64:Buffer.alloc(4).toString('base64')},asset),/no valid depth/);
});
test('the preview is bounded while full point-cloud export keeps every valid prediction',()=>{
  const size=128,count=size*size,depth=Array(count).fill(2),points=depth.flatMap((z,i)=>[i%size,Math.floor(i/size),z]);
  const result={...encoding,width:size,height:size,depthBase64:f32(depth),pointsBase64:f32(points),maskBase64:Buffer.alloc(count,1).toString('base64'),intrinsics:[1,0,0,0,1,0,0,0,1]},asset={width:size,height:size,rgba:Buffer.alloc(count*4,255)};
  const preview=geometryPresentation(result,asset).geometryPreview;assert(preview.displayedPointCount<=12000);assert.equal(preview.validPixelCount,count);
  const selected=new Set();for(let i=0;i<preview.points.length;i+=3){const [x,y,z]=preview.points.slice(i,i+3);assert(Number.isInteger(x)&&x>=0&&x<size&&Number.isInteger(y)&&y>=0&&y<size);assert.equal(z,2);selected.add(y*size+x);}assert.equal(selected.size,preview.displayedPointCount,'Every preview point must come from a distinct real input pixel');
  assert.equal(geometryPly(result,asset).split('end_header\n')[1].trim().split('\n').length,count);
});
