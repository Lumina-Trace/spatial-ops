import {createHash} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {mkdir,rename,unlink,stat} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const target=new URL('../dist/assets/garden.ksplat',import.meta.url);
const temporary=new URL('../dist/assets/garden.ksplat.part',import.meta.url);
const expected='657430e0ce7d3662b2dcc333ba729b9aa8613ddb5522efe6f995311e2275b55f';
async function checksum(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
try{
  await mkdir(new URL('../dist/assets/',import.meta.url),{recursive:true});
  if(await stat(target).catch(()=>null)){
    if(await checksum(target)!==expected)throw Error('已有 garden.ksplat 与示例校验值不同。请先另行保留该文件，本脚本不会覆盖。');
    console.log('Garden 示例已存在，SHA-256 校验通过。');
  }else{
    console.log('下载公开 Garden 实景示例（约 72 MiB）。模型授权说明见 ASSET_SOURCES.md。');
    const response=await fetch('https://projects.markkellogg.org/threejs/assets/data/garden/garden.ksplat',{signal:AbortSignal.timeout(300000)});
    if(!response.ok||!response.body)throw Error(`下载失败：HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body),createWriteStream(temporary));
    if(await checksum(temporary)!==expected)throw Error('示例文件 SHA-256 校验失败，未采用下载文件。');
    await rename(temporary,target);console.log('Garden 实景示例已就绪。');
  }
}catch(error){await unlink(temporary).catch(()=>{});console.error(error.message);process.exitCode=1;}
