import pytest
from app.evaluation import evaluate,validate_manifest

def manifest():
    return {'licenseEvidence':'Fictional owned annotations','deidentificationReviewed':True,'classMap':['fixture'],
      'images':[{'patientId':split,'split':split,'sha256':str(i)*64,'truth':[],'predictions':[]} for i,split in enumerate(['train','validation','test'])]}

def test_patient_and_duplicate_image_leakage_rejected():
    m=manifest();m['images'][2]['patientId']='train'
    with pytest.raises(ValueError,match='leakage'):validate_manifest(m)
    m=manifest();m['images'][2]['sha256']=m['images'][0]['sha256']
    with pytest.raises(ValueError,match='leakage'):validate_manifest(m)

def test_license_review_required():
    m=manifest();m['licenseEvidence']=''
    with pytest.raises(ValueError,match='Licensing'):validate_manifest(m)

def test_real_metrics_undefined_denominators_and_patient_ci():
    m=manifest();m['images'][2].update(truth=[{'classId':0,'box':[1,1,5,5]}],predictions=[{'classId':0,'box':[1,1,5,5],'score':0.9}])
    m['images'].append({'patientId':'negative-test','split':'test','sha256':'a'*64,'truth':[],'predictions':[]})
    result=evaluate(m,threshold=0.5,bootstrap=100)
    cls=result['perClass'][0]
    assert cls['precision']==cls['recall']==cls['sensitivity']==cls['specificity']==1
    assert cls['brier']==pytest.approx(0.005)
    assert cls['confidenceIntervals95']['precision']==[1,1]
    assert result['confusionMatrix'][0][0]==1
    empty=evaluate(manifest(),threshold=0.5,bootstrap=100)['perClass'][0]
    assert empty['precision'] is None and empty['recall'] is None
    assert empty['confidenceIntervals95']['specificity'] is None

def test_calibration_bin_boundaries_do_not_drop_scores():
    m=manifest();m['images'][2].update(truth=[{'classId':0,'box':[1,1,5,5]}],predictions=[{'classId':0,'box':[1,1,5,5],'score':0.6}])
    m['images'].append({'patientId':'negative-test','split':'test','sha256':'a'*64,'truth':[],'predictions':[{'classId':0,'box':[1,1,5,5],'score':0.3}]})
    cls=evaluate(m,threshold=0.5,bootstrap=100)['perClass'][0]
    assert sum(b['count'] for b in cls['calibrationBins'])==2
    assert cls['ece']==pytest.approx(0.35)
