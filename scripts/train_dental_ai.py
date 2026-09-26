import os
from ultralytics import YOLO

def setup_and_train():
    print("--- 1. Setting Up Paths ---")
    # Path to the dataset we converted in the previous step
    # Use absolute path if possible, or ensure this matches your folder name
    dataset_path = os.path.abspath("dataset_yolo") 
    
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
    yaml_filename = 'dental_data.yaml'
    with open(yaml_filename, 'w') as f:
        f.write(data_yaml_content)
    print(f"Created {yaml_filename}")

    # --- 3. Initialize and Train YOLOv8 ---
    print("--- 3. Starting YOLOv8 Training ---")
    # Using 'yolov8n.pt' (Nano) is great for DentalAI testing. 
    # For better accuracy on X-rays, consider 'yolov8s.pt' (Small) if your GPU allows.
    model = YOLO('yolov8n.pt') 
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
        project='dental_training',
        device=device_to_use,  # <--- Use the auto-detected device
        exist_ok=True
    )
  

    # --- 4. Exporting Trained Model ---
    print("--- 4. Exporting Model ---")
    # Exporting to ONNX is perfect for your full-stack dental platform
    model.export(format='onnx')
    
    print("\n✅ Training Complete!")
    print(f"Best weights: dental_training/dental_ai_run/weights/best.pt")

if __name__ == "__main__":
    setup_and_train()