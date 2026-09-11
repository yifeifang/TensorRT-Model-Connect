'use strict';
const zlib=require('node:zlib');
const table=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function chunk(type,data){const tag=Buffer.from(type),body=Buffer.concat([tag,data]);let crc=0xffffffff;for(const b of body)crc=table[(crc^b)&255]^(crc>>>8);const head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([head,body,tail]);}
function png(width,height,rgba){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>4194304||rgba.length!==width*height*4)throw new Error('Invalid RGBA image.');
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  const scan=Buffer.alloc((width*4+1)*height);for(let row=0;row<height;row++)rgba.copy(scan,row*(width*4+1)+1,row*width*4,(row+1)*width*4);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]);
}
module.exports={png};
