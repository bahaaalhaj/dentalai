import json
import numpy as np
import pytest
from app.runtime import Runtime, MAX_RESPONSE_BYTES
from test_runtime import model, image_bytes

def test_normal_response_contains_no_raw_tensor_or_candidates(model):
    result = Runtime(str(model)).infer(image_bytes())
    assert result['responseVersion'] == 'detections-v2'
    assert 'rawPredictions' not in result and 'rawDetections' not in result
    assert len(json.dumps(result).encode()) <= MAX_RESPONSE_BYTES

def test_malformed_and_excessive_tensor_fails_without_findings(model):
    runtime = Runtime(str(model))
    for output in [np.zeros((1, 5, 30001)), np.full((1,5,1), np.nan), np.zeros((1,6,1))]:
        with pytest.raises(ValueError): runtime._output([output])
