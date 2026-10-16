# Maize leaf disease model

Data: PlantVillage maize leaves (CC BY-SA 3.0), 3498 images: healthy 1000, common_rust 1000, northern_leaf_blight 985, gray_leaf_spot 513.
1 images had no leaf found by the segmentation and are excluded from the model (counted as wrong
in the healthy-vs-diseased comparison).

Protocol: stratified 70/15/15 split (seed 42); hyper-parameters by 5-fold CV on train (macro-F1
0.8661); final model fit on train+val (2972 images); test scored once (525 images).
Model: random forest, 100 trees, {'max_depth': None, 'min_samples_leaf': 3, 'max_features': 'sqrt', 'class_weight': 'balanced'}; 38804 nodes, runs on the phone in TypeScript.

## Test set

4-class accuracy **0.8876**, macro-F1 **0.8661**.

```
                      precision    recall  f1-score   support

             healthy      0.987     0.993     0.990       150
         common_rust      0.885     0.920     0.902       150
northern_leaf_blight      0.851     0.851     0.851       148
      gray_leaf_spot      0.757     0.688     0.721        77

            accuracy                          0.888       525
           macro avg      0.870     0.863     0.866       525
        weighted avg      0.886     0.888     0.886       525

```

Confusion matrix (rows = truth, columns = prediction; healthy, common_rust, northern_leaf_blight, gray_leaf_spot):

```
[[149   1   0   0]
 [  1 138   7   4]
 [  0   9 126  13]
 [  1   8  15  53]]
```

Healthy vs diseased (all 525 test images; the app flags a leaf when P(diseased) = 1 - P(healthy) >= 0.8, chosen on val):
model **0.9867**, previous colour rules **0.7581**.

Most important features: green_v (0.096), hue_40 (0.090), yellow (0.059), hue_20 (0.052), hue_60 (0.052), brown (0.049), spot_v (0.048), hue_0 (0.047), contrast_v (0.036), elong_mean (0.034).

## Caveats

- The test set was scored once with an earlier feature set (4-class accuracy 0.886) before features were added
  and the model re-selected by cross-validation on train only; the test numbers above are therefore not
  entirely untouched.

- PlantVillage photos are single detached leaves on a plain background in controlled light. Accuracy on whole
  plants in the field will be lower; the app asks for one leaf filling the frame.
- PlantVillage contains several photos of some leaves, so the random split can put near-duplicates in train and
  test, which flatters the numbers.
- Nutrient problems (nitrogen yellowing, phosphorus purpling) are not in the dataset; the colour rules still
  report those.

## End to end (the app's own code)

scripts/eval_leaf_app.ts runs every test image through the app's pipeline (decode, 512 px, colour rules,
features, forest, combined verdict) and scores what the user sees.

- Healthy vs diseased correct: **510/525 (97.1%)**; the colour rules alone: 398/525 (75.8%).
- Diseased leaves the app names a disease for: 361; the name is right for 306 (84.8%).

| True class | App verdicts |
|---|---|
| healthy | healthy 149, uncertain (lighting) 1 |
| gray_leaf_spot | needs attention 75, healthy 1, uncertain 1 |
| common_rust | needs attention 142, uncertain 2, uncertain (lighting) 3, healthy 3 |
| northern_leaf_blight | needs attention 144, healthy 1, no plant in view 3 |
