import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { releaseTag } from './release-config.mjs';
const tag = releaseTag();
const python = `import os, json, asyncio, importlib.util, uuid
import numpy, onnx, onnxruntime, PIL, ssl, sqlite3
from app.main import create_app
# Exercise the actual native execution provider, not a fabricated clinical endpoint.
graph=onnx.helper.make_graph([onnx.helper.make_node('ReduceMean',['pixels'],['mean'],keepdims=1)],
 'nonclinical-runtime-guard',[onnx.helper.make_tensor_value_info('pixels',onnx.TensorProto.FLOAT,[1,3,32,32])],
 [onnx.helper.make_tensor_value_info('mean',onnx.TensorProto.FLOAT,[1,1,1,1])])
model=onnx.helper.make_model(graph,opset_imports=[onnx.helper.make_opsetid('',13)],ir_version=8)
session=onnxruntime.InferenceSession(model.SerializeToString(),providers=['CPUExecutionProvider'])
for value in (0.0,1.0):
 output=session.run(None,{'pixels':numpy.full((1,3,32,32),value,dtype=numpy.float32)})[0]
 assert numpy.allclose(output,value,rtol=0,atol=1e-6)
assert uuid.uuid4().version == 4
assert importlib.util.find_spec('pip') is None
for path in ['/bin/bash','/usr/bin/perl','/usr/bin/mount','/usr/bin/nsenter','/usr/local/bin/uv']:
 assert not os.path.exists(path), 'Unexpected runtime utility'
async def check():
 app=create_app()
 async with app.router.lifespan_context(app):
  assert app.state.runtime is None
  endpoint=next(r.endpoint for r in app.routes if r.path=='/ready')
  try: await endpoint()
  except Exception as error: assert getattr(error,'status_code',None)==503
  else: raise AssertionError('Missing model cannot be ready')
asyncio.run(check())
print('AI native imports/execution, UUID fallback and missing-model readiness passed.')`;
const commands = [
  [
    'run',
    '--rm',
    '--network',
    'none',
    '--read-only',
    '--user',
    '0:0',
    '--cap-drop',
    'ALL',
    '--cap-add',
    'CHOWN',
    '--cap-add',
    'DAC_OVERRIDE',
    '--cap-add',
    'SETUID',
    '--cap-add',
    'SETGID',
    '--tmpfs',
    '/fixture-secrets:rw,noexec,nosuid,mode=0755',
    '-v',
    `${path.resolve('scripts/prepare-drill-secrets.mjs')}:/helpers/prepare-drill-secrets.mjs:ro`,
    '--entrypoint',
    'node',
    `dentalai-app:${tag}`,
    '--input-type=module',
    '-e',
    `import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {drillSecretNames,setDrillSecretOwnership} from '/helpers/prepare-drill-secrets.mjs';
const directory='/fixture-secrets',file=directory+'/auth_secret';
for(const name of drillSecretNames){const p=directory+'/'+name;fs.writeFileSync(p,'synthetic-only',{mode:0o600});fs.chownSync(p,1001,1001);}
const read=()=>spawnSync(process.execPath,['-e',"require('fs').readFileSync('/fixture-secrets/auth_secret')"],{uid:10001,gid:10001});
if(read().status===0)throw Error('Runner-owned private fixture was unexpectedly readable');
setDrillSecretOwnership(directory);
if(read().status!==0)throw Error('API UID cannot read its private fixture');
for(const name of drillSecretNames){const s=fs.statSync(directory+'/'+name);if(s.uid!==10001||(s.mode&0o777)!==0o600)throw Error('Ownership/mode regression');}
fs.unlinkSync(file);fs.writeFileSync(file,'synthetic-only',{mode:0o644});
let rejected=false;try{setDrillSecretOwnership(directory);}catch{rejected=true;}if(!rejected)throw Error('Unsafe permissions accepted');
fs.unlinkSync(file);fs.symlinkSync(directory+'/smtp_url',file);
rejected=false;try{setDrillSecretOwnership(directory);}catch{rejected=true;}if(!rejected)throw Error('Symlink accepted');
console.log('Linux runner/API secret ownership and private-mode/symlink regressions passed.');`,
  ],
  [
    'run',
    '--rm',
    '--network',
    'none',
    '--entrypoint',
    '/service/.venv/bin/python',
    `dentalai-ai:${tag}`,
    '-c',
    python,
  ],
  [
    'run',
    '--rm',
    '--network',
    'none',
    '--entrypoint',
    'sh',
    `dentalai-postgres:${tag}`,
    '-ec',
    `test ! -e /usr/local/bin/gosu; command -v su-exec; su-exec postgres sh -ec 'test "$(id -u)" = "$(id -u postgres)"; postgres --version'`,
  ],
];
let failed = false;
for (const args of commands) {
  const result = spawnSync('docker', args, { stdio: 'inherit', timeout: 60000 });
  if (result.error || result.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
