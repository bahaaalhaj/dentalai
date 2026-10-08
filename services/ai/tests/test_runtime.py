import hashlib
import io
import json
import numpy as np
import onnx
import pytest
from PIL import Image
from fastapi.testclient import TestClient
from onnx import helper, TensorProto, numpy_helper
from app.main import create_app
from app.runtime import Runtime


def image_bytes():
    output=io.BytesIO()
    Image.new('RGB',(32,32),(255,255,255)).save(output,format='PNG')
    return output.getvalue()


@pytest.fixture
def model(tmp_path,monkeypatch):
    # Non-clinical pipeline fixture: real ONNX execution computes a score from pixels.
    # It is generated only in temporary test storage, not shipped as a replacement dental model.
    coords=numpy_helper.from_array(np.array([[[16.0],[16.0],[8.0],[8.0]]],dtype=np.float32),name='coords')
    graph=helper.make_graph([
        helper.make_node('ReduceMean',['images'],['mean'],keepdims=1),
        helper.make_node('Reshape',['mean','shape'],['score']),
        helper.make_node('Concat',['coords','score'],['output'],axis=1)
    ],'nonclinical-fixture',[helper.make_tensor_value_info('images',TensorProto.FLOAT,[1,3,32,32])],
       [helper.make_tensor_value_info('output',TensorProto.FLOAT,[1,5,1])],
       [coords,numpy_helper.from_array(np.array([1,1,1],dtype=np.int64),name='shape')])
    artifact=helper.make_model(graph,opset_imports=[helper.make_opsetid('',13)],ir_version=8)
    path=tmp_path/'fixture.onnx';onnx.save(artifact,path)
    manifest={'modelName':'nonclinical-pipeline-fixture','modelVersion':'test-v1','artifact':'fixture.onnx','artifactSha256':hashlib.sha256(path.read_bytes()).hexdigest(),
              'classMap':['fixture-object'],'inputSize':32,'confidenceThreshold':0.5,'iouThreshold':0.45,
              'license':'Project-owned generated test graph','provenance':'Synthetic pixels; no patients, datasets or trained weights','purpose':'pipeline_fixture'}
    manifest_path=tmp_path/'manifest.json';manifest_path.write_text(json.dumps(manifest))
    monkeypatch.setenv('AI_ENV','test');monkeypatch.setenv('AI_SERVICE_TOKEN','t'*32);monkeypatch.setenv('AI_MODEL_MANIFEST',str(manifest_path))
    return manifest_path


def test_deterministic_actual_onnx_inference(model):
    runtime=Runtime(str(model));data=image_bytes()
    one=runtime.infer(data);two=runtime.infer(data)
    assert one['detections']==two['detections']
    assert one['detections'][0]['score']==pytest.approx(1.0,abs=1e-6)
    assert one['detections'][0]['box']==pytest.approx([12,12,8,8],abs=1e-4)
    assert one['imageSha256']==hashlib.sha256(data).hexdigest()
    assert one['artifactSha256']==json.loads(model.read_text())['artifactSha256']


def test_fixture_cannot_activate_outside_tests(model,monkeypatch):
    monkeypatch.setenv('AI_ENV','production')
    with pytest.raises(ValueError,match='outside tests'):Runtime(str(model))


def test_checksum_corruption_safe_unavailable(model):
    artifact=model.parent/'fixture.onnx';artifact.write_bytes(b'corrupt')
    with TestClient(create_app()) as client:
        assert client.get('/ready').status_code==503
        response=client.post('/v1/infer',headers={'authorization':'Bearer '+'t'*32,'content-type':'image/png'},content=image_bytes())
        assert response.status_code==503
        assert 'detections' not in response.json()


def test_missing_model_and_service_auth(monkeypatch):
    monkeypatch.delenv('AI_MODEL_MANIFEST',raising=False);monkeypatch.setenv('AI_SERVICE_TOKEN','t'*32)
    with TestClient(create_app()) as client:
        assert client.get('/health').json()['inference_available'] is False
        assert client.get('/ready').status_code==503
        assert client.post('/v1/infer').status_code==401
        response=client.post('/v1/infer',headers={'authorization':'Bearer '+'t'*32})
        assert response.status_code==503
        assert response.json()=={'detail':'INFERENCE_UNAVAILABLE'}


def test_endpoint_actual_fixture_and_decode_failure(model):
    with TestClient(create_app()) as client:
        assert client.get('/ready').status_code==200
        headers={'authorization':'Bearer '+'t'*32,'content-type':'image/png'}
        assert client.post('/v1/infer',headers=headers,content=image_bytes()).json()['detections'][0]['score']==1.0
        bad=client.post('/v1/infer',headers=headers,content=b'<svg/>')
        assert bad.status_code==503
        assert bad.json()=={'detail':'INFERENCE_FAILED'}
        assert client.post('/v1/infer',headers=headers,content=b'x'*(10*1024*1024+1)).status_code==413

def test_randomized_model_artifact_is_rejected_without_results(model):
    manifest=json.loads(model.read_text());path=model.parent/'fixture.onnx'
    graph=helper.make_graph([helper.make_node('RandomUniform',[],['output'],shape=[1,5,1],dtype=TensorProto.FLOAT)],
      'forbidden-random-model',[helper.make_tensor_value_info('images',TensorProto.FLOAT,[1,3,32,32])],
      [helper.make_tensor_value_info('output',TensorProto.FLOAT,[1,5,1])])
    onnx.save(helper.make_model(graph,opset_imports=[helper.make_opsetid('',13)],ir_version=8),path)
    manifest['artifactSha256']=hashlib.sha256(path.read_bytes()).hexdigest();model.write_text(json.dumps(manifest))
    with pytest.raises(ValueError,match='Stochastic'):Runtime(str(model))
    with TestClient(create_app()) as client:
        assert client.get('/ready').status_code==503
        response=client.post('/v1/infer',headers={'authorization':'Bearer '+'t'*32,'content-type':'image/png'},content=image_bytes())
        assert response.status_code==503 and 'detections' not in response.json()
