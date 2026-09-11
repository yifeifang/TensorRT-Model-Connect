import base64
import json
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "models" / "geometry-validation"
limits = json.loads((ROOT / "vendor" / "ModelConnect" / "families" / "moge" / "tests" / "thresholds" / "moge-2-vitl.json").read_text())["threshold_overrides"]
receipt = json.loads((OUT / "reference-receipt.json").read_text())
for item in receipt["results"]:
    name = item["name"]
    actual = json.loads((OUT / (name + "-native.json")).read_text())
    height, width = actual["height"], actual["width"]
    points = np.frombuffer(base64.b64decode(actual["pointsBase64"]), dtype="<f4").reshape(height, width, 3)
    depth = np.frombuffer(base64.b64decode(actual["depthBase64"]), dtype="<f4").reshape(height, width)
    mask = np.frombuffer(base64.b64decode(actual["maskBase64"]), dtype=np.uint8).reshape(height, width).astype(bool)
    intrinsics = np.asarray(actual["intrinsics"], dtype=np.float64).reshape(3,3)
    with np.load(OUT / (name + "-reference.npz"), allow_pickle=False) as reference:
        ref_mask = reference["mask"].astype(bool)
        common = mask & ref_mask
        union = mask | ref_mask
        assert common.any()
        a_depth, r_depth = depth[common].astype(np.float64), reference["depth"][common].astype(np.float64)
        a_points, r_points = points[common].astype(np.float64), reference["points"][common].astype(np.float64)
        delta_depth, delta_points = a_depth-r_depth, a_points-r_points
        r_intrinsics = reference["intrinsics"].astype(np.float64)
        nonzero = np.abs(r_intrinsics)>1e-12
        metrics = {
            "mask_iou": float(common.sum()/union.sum()),
            "depth_absrel_mean": float(np.mean(np.abs(delta_depth)/np.maximum(np.abs(r_depth),1e-12))),
            "depth_rel_l2": float(np.linalg.norm(delta_depth)/max(np.linalg.norm(r_depth),1e-12)),
            "points_rel_l2": float(np.linalg.norm(delta_points)/max(np.linalg.norm(r_points),1e-12)),
            "points_cosine": float(np.mean(np.sum(a_points*r_points,axis=-1)/np.maximum(np.linalg.norm(a_points,axis=-1)*np.linalg.norm(r_points,axis=-1),1e-12))),
            "intrinsics_max_relative_error": float(np.max(np.abs(intrinsics-r_intrinsics)[nonzero]/np.abs(r_intrinsics)[nonzero])),
            "point_depth_consistency": float(np.max(np.abs(points[...,2][mask]-depth[mask]))),
        }
    item.update({"metrics":metrics,"thresholds":limits,"checks":{key:bool(value>=limits[key] if key in {"mask_iou","points_cosine"} else value<=limits[key]) for key,value in metrics.items()}})
    low, high = np.percentile(depth[mask], [2,98])
    scale = np.clip((depth-low)/max(high-low,1e-8),0,1)
    scale[~mask]=0
    color = np.stack((1-scale, 1-np.abs(2*scale-1), scale),axis=-1)
    color[~mask]=0
    Image.fromarray((color*255).astype(np.uint8)).save(OUT/(name+"-depth.png"))
    Image.fromarray((mask*255).astype(np.uint8)).save(OUT/(name+"-mask.png"))
    print(json.dumps(item,indent=2))
receipt["passed"] = all(all(item["checks"].values()) for item in receipt["results"])
(OUT/"qualification.json").write_text(json.dumps(receipt,indent=2)+"\n")
if not receipt["passed"]:
    raise SystemExit("Geometry outputs did not meet all independent reference thresholds")
