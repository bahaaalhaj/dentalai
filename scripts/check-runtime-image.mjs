import { spawnSync } from 'node:child_process';
import { releaseTag } from './release-config.mjs';
const image = `dentalai-app:${releaseTag()}`;
const code = `const fs=require('node:fs');
for(const p of ['/usr/local/lib/node_modules/npm','/usr/bin/perl','/usr/bin/mount','/usr/bin/nsenter','/bin/sh','/app/node_modules/drizzle-kit','/app/node_modules/vite','/app/node_modules/esbuild','/app/node_modules/@esbuild-kit']) if(fs.existsSync(p)) throw Error('Unexpected runtime toolchain: '+p);
const path=require('node:path'), affected={'brace-expansion':['2.0.2'],'http-cache-semantics':['4.2.0'],'ip-address':['10.1.0'],'pacote':['19.0.2','20.0.1'],'picomatch':['4.0.3'],'sigstore':['3.1.0']};
function inspect(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(!e.isDirectory())continue;const d=path.join(dir,e.name);if(e.name.startsWith('@')){inspect(d);continue;}const file=path.join(d,'package.json');if(fs.existsSync(file)){const p=JSON.parse(fs.readFileSync(file));if(affected[p.name]?.includes(p.version))throw Error('Attached report vulnerable package remains: '+p.name+'@'+p.version);}if(fs.existsSync(path.join(d,'node_modules')))inspect(path.join(d,'node_modules'));}}inspect('/app/node_modules');
Promise.all(['better-auth','sharp','pg','@dentalai/database','@dentalai/contracts','./apps/api/dist/app.js'].map(p=>import(p))).then(()=>console.log('Runtime imports/native image library passed; build toolchain absent.')).catch(()=>process.exit(1));`;
const result = spawnSync(
  'docker',
  ['run', '--rm', '--network', 'none', '--entrypoint', 'node', image, '-e', code],
  { stdio: 'inherit', timeout: 60000 },
);
process.exitCode = result.error ? 1 : (result.status ?? 1);
