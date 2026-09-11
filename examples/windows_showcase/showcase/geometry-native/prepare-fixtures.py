import hashlib
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "models" / "geometry-fixtures"
TARGET.mkdir(parents=True, exist_ok=True)
sources = {
    "car": ROOT / "showcase" / "renderer" / "fixtures" / "vision-car.jpeg",
    "house": ROOT / "models" / "geometry-reference" / "MoGe-74fbce054ebed49800de42d0ad0e83495065719a" / "example_images" / "01_HouseIndoor.jpg",
}
records = []
for name, source in sources.items():
    image = Image.open(source).convert("RGB")
    width, height = image.size
    scale = min(1, 512 / max(width, height))
    if scale != 1:
        image = image.resize((round(width * scale), round(height * scale)), Image.Resampling.LANCZOS)
    image.save(TARGET / (name + ".png"))
    image.save(TARGET / (name + ".ppm"))
    records.append({"name": name, "source": str(source.relative_to(ROOT)), "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(), "width": image.width, "height": image.height, "resampling": "Pillow LANCZOS", "ppmSha256": hashlib.sha256((TARGET / (name + '.ppm')).read_bytes()).hexdigest()})
(TARGET / "provenance.json").write_text(json.dumps(records, indent=2) + "\n")
print(json.dumps(records, indent=2))
