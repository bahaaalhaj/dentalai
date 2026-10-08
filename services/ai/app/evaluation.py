"""Offline evaluation only. Bootstrap resamples patients, never creates inference findings."""
import argparse
import json
from pathlib import Path
import numpy as np
from .runtime import overlap


def validate_manifest(manifest):
    if not manifest.get('licenseEvidence') or manifest.get('deidentificationReviewed') is not True:
        raise ValueError('Licensing and de-identification review are required')
    patients={}; hashes={}
    for row in manifest['images']:
        split=row['split']; patient=row['patientId']; digest=row['sha256']
        if split not in ('train','validation','test') or not patient or len(digest)!=64:
            raise ValueError('Invalid patient-level evaluation manifest')
        if patients.setdefault(patient,split)!=split or hashes.setdefault(digest,split)!=split:
            raise ValueError('Patient or duplicate image leakage across splits')
    if set(patients.values())!={'train','validation','test'}:
        raise ValueError('All three patient-disjoint splits are required')


def ratio(n,d):
    return n/d if d else None


def measure(rows,classes,threshold,iou=0.5):
    confusion=np.zeros((len(classes)+1,len(classes)+1),dtype=int)
    counts=[{'tp':0,'fp':0,'fn':0,'tn':0,'presenceTp':0,'presenceFn':0} for _ in classes]
    calibration=[[] for _ in classes]
    for row in rows:
        truth=row['truth']; predictions=sorted([d for d in row['predictions'] if d['score']>=threshold],key=lambda d:-d['score']); used=set()
        for pred in predictions:
            matches=[(overlap(pred['box'],actual['box']),i) for i,actual in enumerate(truth) if i not in used]
            match=max(matches,default=(0,-1))
            if match[0]>=iou:
                index=match[1];used.add(index);actual=truth[index];confusion[actual['classId'],pred['classId']]+=1
            else:confusion[len(classes),pred['classId']]+=1
        for i,actual in enumerate(truth):
            if i not in used:confusion[actual['classId'],len(classes)]+=1
        for cid in range(len(classes)):
            actual_boxes=[d for d in truth if d['classId']==cid];matched=set()
            for pred in [d for d in predictions if d['classId']==cid]:
                match=max(((overlap(pred['box'],d['box']),i) for i,d in enumerate(actual_boxes) if i not in matched),default=(0,-1))
                if match[0]>=iou:matched.add(match[1]);counts[cid]['tp']+=1
                else:counts[cid]['fp']+=1
            counts[cid]['fn']+=len(actual_boxes)-len(matched)
            actual=any(d['classId']==cid for d in truth)
            score=max((d['score'] for d in row['predictions'] if d['classId']==cid),default=0.0)
            predicted=score>=threshold
            if not actual and not predicted:counts[cid]['tn']+=1
            if actual and predicted:counts[cid]['presenceTp']+=1
            if actual and not predicted:counts[cid]['presenceFn']+=1
            calibration[cid].append((score,int(actual)))
    per_class=[]
    for cid,count in enumerate(counts):
        points=calibration[cid]; bins=[];ece=0.0
        for index in range(10):
            lower=index/10
            sample=[(s,y) for s,y in points if min(int(s*10),9)==index]
            confidence=sum(s for s,_ in sample)/len(sample) if sample else None
            frequency=sum(y for _,y in sample)/len(sample) if sample else None
            if sample:ece+=len(sample)/len(points)*abs(confidence-frequency)
            bins.append({'lower':float(lower),'count':len(sample),'confidence':confidence,'observedFrequency':frequency})
        negatives=sum(not y for _,y in points)
        per_class.append({'className':classes[cid],**count,'precision':ratio(count['tp'],count['tp']+count['fp']),
          'recall':ratio(count['tp'],count['tp']+count['fn']), 'sensitivity':ratio(count['presenceTp'],count['presenceTp']+count['presenceFn']),
          'specificity':ratio(count['tn'],negatives),'brier':sum((s-y)**2 for s,y in points)/len(points) if points else None,
          'ece':ece if points else None,'calibrationBins':bins})
    return {'perClass':per_class,'confusionMatrix':confusion.tolist(),'confusionLabels':classes+['background']}


def evaluate(manifest,threshold=0.25,bootstrap=1000):
    validate_manifest(manifest)
    rows=[r for r in manifest['images'] if r['split']=='test']
    classes=manifest['classMap']
    if not rows or not classes or not 0<threshold<1 or bootstrap<100:
        raise ValueError('Invalid evaluation configuration')
    for row in rows:
        for key in ('truth','predictions'):
            for detection in row[key]:
                if not 0<=detection['classId']<len(classes) or len(detection['box'])!=4 or not all(np.isfinite(detection['box'])) or min(detection['box'][:2])<0 or min(detection['box'][2:])<=0:
                    raise ValueError('Invalid annotation or prediction')
                if key=='predictions' and not 0<=detection['score']<=1:raise ValueError('Invalid model score')
    result=measure(rows,classes,threshold)
    ids=sorted({r['patientId'] for r in rows});rng=np.random.default_rng(20261008)
    metrics=('precision','recall','sensitivity','specificity','brier','ece')
    samples=[{metric:[] for metric in metrics} for _ in classes]
    for _ in range(bootstrap):
        selected=rng.choice(ids,size=len(ids),replace=True)
        trial=measure([r for patient in selected for r in rows if r['patientId']==patient],classes,threshold)
        for cid,item in enumerate(trial['perClass']):
            for metric in metrics:
                if item[metric] is not None:samples[cid][metric].append(item[metric])
    for cid,item in enumerate(result['perClass']):
        item['confidenceIntervals95']={metric:np.quantile(values,[0.025,0.975]).tolist() if values and len(ids)>1 else None for metric,values in samples[cid].items()}
        item['ciDefinedReplicates']={metric:len(values) for metric,values in samples[cid].items()}
    return {**result,'testPatients':len(ids),'testImages':len(rows),'confidenceThreshold':threshold,'matchingIou':0.5,
            'bootstrapReplicates':bootstrap,'bootstrapUnit':'patient','clinicalValidation':'pending',
            'metricDefinitions':'Precision/recall: detection IoU matching. Sensitivity/specificity and calibration: image-level class presence; not patient diagnosis. Undefined denominators and insufficient CI clusters are null.'}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('manifest');parser.add_argument('--threshold',type=float,required=True)
    args=parser.parse_args()
    print(json.dumps(evaluate(json.loads(Path(args.manifest).read_text()),args.threshold),indent=2,allow_nan=False))
