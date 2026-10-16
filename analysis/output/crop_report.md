# Crop recommendation dataset: analysis

- Rows: 2200, crops: 22, rows per crop: 100 (perfectly balanced)
- Ranges look synthetic: every crop has an N spread of ~40, P ~25 and K ~10, sampled uniformly.
- The data is soil-based and has no growth stage or yield column. It defines *where a crop is happy*,
  not *what maximises yield*, so we use it as a prior and learn the rest from our own sensor logs.

## Chosen crop: maize

| Parameter | 5th-95th percentile |
|---|---|
| N | 60.95 - 99.0 |
| P | 35.0 - 60.0 |
| K | 15.0 - 25.0 |
| temperature | 18.28 - 25.98 |
| humidity | 56.5 - 73.59 |
| ph | 5.59 - 6.87 |
| rainfall | 63.03 - 108.52 |

Suitability model (temperature+humidity+ph only, maize vs rest): 5-fold ROC-AUC = **0.967**

## Indoor feasibility ranking (room ~28 °C / 60% RH)

`control_effort` = how far the crop's climate band sits from room conditions (temperature weighted 3x,
since heating/cooling is harder than misting). Lower is easier.

| crop        | temp_band   | hum_band   | ph_band   |   temp_gap_c |   hum_gap_pct |   control_effort |
|:------------|:------------|:-----------|:----------|-------------:|--------------:|-----------------:|
| mothbeans   | 24.5-31.2   | 42-63      | 3.69-9.41 |          0   |           0   |              0   |
| pigeonpeas  | 19.0-36.2   | 32-67      | 4.67-7.17 |          0   |           0   |              0   |
| blackgram   | 25.6-34.1   | 60-69      | 6.54-7.71 |          0   |           0.4 |              0.4 |
| lentil      | 18.4-29.2   | 60-69      | 6.06-7.73 |          0   |           0.5 |              0.5 |
| coffee      | 23.2-27.6   | 51-68      | 6.08-7.46 |          0.4 |           0   |              1.3 |
| mango       | 27.4-35.5   | 46-54      | 4.67-6.82 |          0   |           5.6 |              5.6 |
| maize       | 18.3-26.0   | 56-74      | 5.59-6.87 |          2   |           0   |              6.1 |
| jute        | 23.2-26.8   | 71-88      | 6.07-7.38 |          1.2 |          11.3 |             14.8 |
| banana      | 25.1-29.4   | 76-85      | 5.57-6.44 |          0   |          16.1 |             16.1 |
| grapes      | 9.9-40.7    | 80-84      | 5.56-6.48 |          0   |          20.1 |             20.1 |
| mungbean    | 27.1-29.9   | 80-90      | 6.27-7.17 |          0   |          20.5 |             20.5 |
| cotton      | 22.1-25.7   | 76-85      | 6.00-7.95 |          2.3 |          15.6 |             22.6 |
| watermelon  | 24.3-26.8   | 80-90      | 6.07-6.93 |          1.2 |          20.5 |             24   |
| rice        | 20.3-26.7   | 80-85      | 5.11-7.63 |          1.3 |          20.3 |             24.1 |
| orange      | 11.0-34.1   | 90-95      | 6.12-7.86 |          0   |          30.2 |             30.2 |
| papaya      | 23.7-42.9   | 90-95      | 6.52-6.99 |          0   |          30.2 |             30.2 |
| muskmelon   | 27.1-29.9   | 90-95      | 6.04-6.74 |          0   |          30.3 |             30.3 |
| coconut     | 25.1-29.5   | 91-100     | 5.55-6.42 |          0   |          31   |             31   |
| pomegranate | 18.4-24.8   | 86-95      | 5.68-7.13 |          3.2 |          25.5 |             35.1 |
| apple       | 21.2-23.8   | 90-95      | 5.56-6.40 |          4.2 |          30.2 |             42.8 |
| kidneybeans | 15.8-24.3   | 18-25      | 5.52-5.97 |          3.7 |          35.1 |             46.1 |
| chickpea    | 17.2-20.7   | 14-20      | 6.18-8.74 |          7.3 |          40.3 |             62.2 |
