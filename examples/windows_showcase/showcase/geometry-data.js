'use strict';
const {png}=require('./png');

function decodeGeometry(result,asset){
  const {width,height}=result;
  if(result.depthEncoding!=='float32le'||result.pointsEncoding!=='float32le-xyz'||result.maskEncoding!=='u8-validity'||result.invalidValue!=='+Infinity')throw new Error('The geometry model returned an unsupported data encoding.');
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>512||height>512||width!==asset.width||height!==asset.height)throw new Error('The predicted geometry dimensions do not match the image.');
  const count=width*height;
  const read=(value,bytes)=>{
    if(typeof value!=='string'||value.length!==Math.ceil(bytes/3)*4||value.length%4||/[^A-Za-z0-9+/=]/.test(value)||!/^={0,2}$/.test(value.slice(value.indexOf('=')<0?value.length:value.indexOf('='))))throw new Error('The geometry model returned invalid binary data.');
    const data=Buffer.from(value,'base64');if(data.length!==bytes)throw new Error('The geometry model returned an invalid data size.');return data;
  };
  const depth=read(result.depthBase64,count*4),points=read(result.pointsBase64,count*12),mask=read(result.maskBase64,count);
  if(!Array.isArray(result.intrinsics)||result.intrinsics.length!==9||result.intrinsics.some(v=>!Number.isFinite(v)))throw new Error('The geometry model returned invalid camera parameters.');
  const indices=[],depths=[];
  for(let i=0;i<count;i++){
    if(mask[i]>1)throw new Error('The geometry model returned a non-binary validity mask.');
    if(!mask[i]){
      if(depth.readFloatLE(i*4)!==Infinity||[0,4,8].some(offset=>points.readFloatLE(i*12+offset)!==Infinity))throw new Error('Invalid geometry pixels must preserve the declared missing-value encoding.');
      continue;
    }
    const d=depth.readFloatLE(i*4),x=points.readFloatLE(i*12),y=points.readFloatLE(i*12+4),z=points.readFloatLE(i*12+8);
    if(!Number.isFinite(d)||d<=0||![x,y,z].every(Number.isFinite)||z<=0)throw new Error('The geometry model returned non-finite or non-positive valid geometry.');
    if(Math.abs(z-d)>Math.max(1e-6,d*1e-6))throw new Error('The predicted point depth does not match the depth map.');
    indices.push(i);depths.push(d);
  }
  if(!indices.length)throw new Error('The model found no valid depth in this image. Try another scene.');
  if(result.validPixelCount!==undefined&&result.validPixelCount!==indices.length)throw new Error('The geometry validity count does not match its mask.');
  return{width,height,count,depth,points,mask,indices,depths};
}

function geometryPresentation(result,asset){
  const g=decodeGeometry(result,asset),ordered=[...g.depths].sort((a,b)=>a-b);
  const low=ordered[Math.floor((ordered.length-1)*.01)],high=ordered[Math.ceil((ordered.length-1)*.99)],inverseSpan=Math.max(1/low-1/high,1e-8);
  const palette=[[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],pixels=Buffer.alloc(g.count*4);
  for(const i of g.indices){
    // Inverse-depth color spacing keeps nearby structures visible when a scene
    // also contains a distant background. Raw depth and XYZ remain untouched.
    const value=Math.max(0,Math.min(1,(1/low-1/g.depth.readFloatLE(i*4))/inverseSpan))*(palette.length-1),a=Math.min(palette.length-2,Math.floor(value)),t=value-a;
    for(let c=0;c<3;c++)pixels[i*4+c]=Math.round(palette[a][c]*(1-t)+palette[a+1][c]*t);
    pixels[i*4+3]=255;
  }
  const preview={points:[],colors:[],validPixelCount:g.indices.length,displayedPointCount:0,depthMin:low,depthMax:high,depthScale:'inverse-depth'};
  const stride=Math.max(1,Math.ceil(g.indices.length/12000));
  for(let n=0;n<g.indices.length;n+=stride){
    // Pick one real pixel from each disjoint stratum. A fixed every-Nth-pixel
    // pattern aliases with image rows and creates distracting diagonal stripes.
    let hash=Math.imul(Math.floor(n/stride)+1,0x9e3779b1)>>>0;hash=(hash^(hash>>>16))>>>0;
    const i=g.indices[n+hash%Math.min(stride,g.indices.length-n)];for(let c=0;c<3;c++)preview.points.push(g.points.readFloatLE(i*12+c*4));
    const alpha=asset.rgba[i*4+3]/255;for(let c=0;c<3;c++)preview.colors.push(Math.round(asset.rgba[i*4+c]*alpha+255*(1-alpha)));
  }
  preview.displayedPointCount=preview.points.length/3;
  return{depthDataUrl:`data:image/png;base64,${png(g.width,g.height,pixels).toString('base64')}`,geometryPreview:preview};
}

function geometryPly(result,asset){
  const g=decodeGeometry(result,asset);
  const lines=['ply','format ascii 1.0','comment ModelConnect predicted geometry; coordinates are model output',`element vertex ${g.indices.length}`,'property float x','property float y','property float z','property uchar red','property uchar green','property uchar blue','end_header'];
  for(const i of g.indices){
    const xyz=[0,4,8].map(offset=>g.points.readFloatLE(i*12+offset));
    const alpha=asset.rgba[i*4+3]/255,rgb=[0,1,2].map(c=>Math.round(asset.rgba[i*4+c]*alpha+255*(1-alpha)));
    lines.push([...xyz,...rgb].join(' '));
  }
  return lines.join('\n')+'\n';
}
module.exports={decodeGeometry,geometryPresentation,geometryPly};
