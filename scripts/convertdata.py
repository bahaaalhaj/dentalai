import os
import pandas as pd
import shutil
from PIL import Image

# -------- CONFIG --------
# Added 'r' to fix the SyntaxWarning (raw string)
BASE_DATASET = r"scripts\dataset"
IMAGES_SRC = os.path.join(BASE_DATASET, "Images")
LABELS_SRC = os.path.join(BASE_DATASET, "labels")
OUTPUT_DIR = "dataset_yolo"

# --- DEFINE YOUR CLASSES HERE ---
# YOLO needs numbers. Map your text labels to integers starting at 0.
# --- DEFINE YOUR CLASSES HERE ---
CLASS_MAP = {
    "Fillings": 0,
    "Caries": 1,
    "Implant": 2,
    "Cavity": 3,
    "Impacted Tooth": 4,
    # Add any others that appear in your console here
}
# ------------------------

def convert_to_yolo():
    if not os.path.exists(LABELS_SRC):
        print(f"❌ Error: {LABELS_SRC} not found!")
        return

    splits = ["train", "test", "valid"]

    for split in splits:
        print(f"\n--- Processing {split} ---")
        
        csv_path = os.path.join(LABELS_SRC, f"{split}.csv")
        if not os.path.exists(csv_path):
            print(f"⚠️ Skipping {split}: {csv_path} not found.")
            continue

        os.makedirs(f"{OUTPUT_DIR}/images/{split}", exist_ok=True)
        os.makedirs(f"{OUTPUT_DIR}/labels/{split}", exist_ok=True)

        df = pd.read_csv(csv_path)
        grouped = df.groupby("filename")

        for filename, group in grouped:
            img_src_path = os.path.join(IMAGES_SRC, split, filename)

            if not os.path.exists(img_src_path):
                continue

            # Copy Image
            shutil.copy(img_src_path, f"{OUTPUT_DIR}/images/{split}/{filename}")

            # Process Labels
            img = Image.open(img_src_path)
            w, h = img.size
            
            label_name = os.path.splitext(filename)[0] + ".txt"
            label_path = os.path.join(OUTPUT_DIR, "labels", split, label_name)

            with open(label_path, "w") as f:
                for _, row in group.iterrows():
                    # Get the name from the CSV (e.g., 'Fillings')
                    class_name = str(row["class"])
                    
                    # Convert name to ID using our map
                    if class_name in CLASS_MAP:
                        class_id = CLASS_MAP[class_name]
                    else:
                        # Fallback if a class isn't in your map yet
                        print(f"⚠️ Warning: Class '{class_name}' not in CLASS_MAP. Skipping row.")
                        continue

                    # YOLO math
                    x_center = ((row["xmin"] + row["xmax"]) / 2) / w
                    y_center = ((row["ymin"] + row["ymax"]) / 2) / h
                    width = (row["xmax"] - row["xmin"]) / w
                    height = (row["ymax"] - row["ymin"]) / h

                    f.write(f"{class_id} {x_center:.6f} {y_center:.6f} {width:.6f} {height:.6f}\n")

    print(f"\n✅ Done! Dataset ready in: {OUTPUT_DIR}")

if __name__ == "__main__":
    convert_to_yolo()