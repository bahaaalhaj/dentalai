import os
from pathlib import Path

# Legacy training recipe retained for provenance, but all data/output/model paths must be external.
def external_path(name):
    value=os.environ.get(name)
    if not value or not Path(value).is_absolute():
        raise RuntimeError(f'{name} must name an explicitly configured absolute external path')
    resolved=Path(value).resolve()
    root=Path(__file__).resolve().parents[1]
    if resolved==root or root in resolved.parents:
        raise RuntimeError(f'{name} must be outside the application repository')
    return str(resolved)

from ultralytics import YOLO

def setup_and_train():
    print("--- 1. Setting Up Paths ---")
    # Path to the dataset we converted in the previous step
    # Use absolute path if possible, or ensure this matches your folder name
    dataset_path = external_path('ML_DATASET_DIRECTORY')
    output_path = external_path('ML_OUTPUT_DIRECTORY')
    initial_model = external_path('ML_INITIAL_MODEL')
    if os.environ.get('ML_LICENSE_AND_PATIENT_SPLITS_REVIEWED') != 'true':
        raise RuntimeError('Licensing, de-identification and patient-level splits must be reviewed before training')
    
    print(f"Using YOLO formatted dataset at: {dataset_path}")

    # --- 2. Generating the YOLO YAML Configuration ---
    # It's safer to use the absolute path in the YAML for the 'path' key
    data_yaml_content = f"""
path: {dataset_path}
train: images/train
val: images/valid
test: images/test

nc: 5
names: [
  'Fillings', 
  'Caries', 
  'Implant', 
  'Cavity', 
  'Impacted Tooth'
]
"""
    os.makedirs(output_path,exist_ok=True)
    yaml_filename = os.path.join(output_path,'dental_data.yaml')
    with open(yaml_filename, 'w') as f:
        f.write(data_yaml_content)
    print(f"Created {yaml_filename}")

    # --- 3. Initialize and Train YOLOv8 ---
    print("--- 3. Starting YOLOv8 Training ---")
    # Using 'yolov8n.pt' (Nano) is great for DentalAI testing. 
    # For better accuracy on X-rays, consider 'yolov8s.pt' (Small) if your GPU allows.
    model = YOLO(initial_model)
    import torch

# ... inside your setup_and_train function ...

    # Automatically detect if CUDA is available
    device_to_use = 0 if torch.cuda.is_available() else 'cpu'
    print(f"--- Training on: {device_to_use} ---")

    results = model.train(
        data=yaml_filename,
        epochs=50,
        imgsz=640,
        batch=16,
        name='dental_ai_run',
        project=output_path,
        device=device_to_use,  # <--- Use the auto-detected device
        seed=20261008,
        deterministic=True,
        exist_ok=False
    )
  

    # --- 4. Exporting Trained Model ---
    print("--- 4. Exporting Model ---")
    # Exporting to ONNX is perfect for your full-stack dental platform
    model.export(format='onnx')
    
    print("\n✅ Training Complete!")
    print(f"Best weights: dental_training/dental_ai_run/weights/best.pt")

if __name__ == "__main__":
    setup_and_train()
