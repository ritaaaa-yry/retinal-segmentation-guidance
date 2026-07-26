# Retinal Vessel Datasets and ML Algorithms

This repository records the public datasets and machine-learning/deep-learning algorithms used in our retinal vessel segmentation and artery/vein analysis work.

The repository is intended as a provenance and reproducibility index. It does not redistribute third-party datasets or model code. Please follow the license, citation, access, and usage requirements of each original dataset and algorithm provider.

## Scope

- Test datasets used for retinal vessel segmentation / artery-vein analysis.
- Training dataset used for vessel segmentation model development.
- Five model papers and their corresponding public code repositories where available.
- Future local outputs, scripts, and result summaries can be added later.

## Test Datasets

| Dataset | Link | Notes |
|---|---|---|
| STARE | http://cecas.clemson.edu/~ahoover/stare/ | Public retinal image dataset page. |
| CHASE_DB1 | https://blogs.kingston.ac.uk/retinal/chasedb1/ | Public CHASE_DB1 dataset page. |
| HRF | https://www5.cs.fau.de/research/data/fundus-images/ | High-Resolution Fundus image dataset page. |
| DualModal2019 | https://ieee-dataport.org/documents/dualmodal2019-dataset | IEEE DataPort dataset page. Access may require IEEE DataPort terms. |
| LES-AV | https://github.com/ignaciorlando/glaucoma-hemodynamics | LES-AV / glaucoma hemodynamics resource repository. |
| AFIO | https://data.mendeley.com/datasets/3csr652p9y/1 | Mendeley Data dataset page. |

## Training Dataset

| Dataset | Link | Notes |
|---|---|---|
| Fundus Image Dataset for Vessel Segmentation | https://www.kaggle.com/datasets/nikitamanaenkov/fundus-image-dataset-for-vessel-segmentation | Kaggle training dataset used for vessel segmentation experiments. |

## ML Algorithms / Model Papers

| Short name | Paper | Paper link | Code / model link | Status |
|---|---|---|---|---|
| DCP / UNet_DCP_1024 | Convolutional Prompting for Broad-Domain Retinal Vessel Segmentation | https://arxiv.org/abs/2412.18089 | https://github.com/ruc-aimc-lab/dcp; https://huggingface.co/AIMClab-RUC/UNet_DCP_1024 | Public code/model links found. |
| FSG-Net | Full-scale Representation Guided Network for Retinal Vessel Segmentation | https://arxiv.org/abs/2501.18921 | https://github.com/ZombaSY/FSG-Net-pytorch | Public code link found. |
| SA-UNetv2 | SA-UNetv2: Rethinking Spatial Attention U-Net for Retinal Vessel Segmentation | https://arxiv.org/abs/2509.11774 | https://github.com/clguo/SA-UNetv2 | Public code link found. |
| FR-UNet | Full-Resolution Network and Dual-Threshold Iteration for Retinal Vessel and Coronary Angiograph Segmentation | https://doi.org/10.1109/JBHI.2022.3188710 | https://github.com/lseventeen/FR-UNet | Public code link found. |
| RIP-AV | RIP-AV: Joint Representative Instance Pre-training with Context Aware Network for Retinal Artery/Vein Segmentation | https://papers.miccai.org/miccai-2024/660-Paper1711.html | https://github.com/weidai00/RIP-AV | Public code link found. |

## Repository Structure

```text
.
|-- README.md
|-- data/
|   |-- test_datasets.csv
|   |-- training_datasets.csv
|   `-- ml_algorithms.csv
`-- docs/
    `-- citation_and_license_notes.md
```

## Citation and License Notes

This repository is a curated index. Cite the original dataset and algorithm papers according to their official instructions. Do not assume that dataset access rights or model licenses are identical across resources.

