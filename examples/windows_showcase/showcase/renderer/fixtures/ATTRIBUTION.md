# Demonstration input attribution

Only `vision-car.jpeg` is included in the source distribution. Its photographer's
explicit Apache-2.0 grant is retained in `vision-car.LICENSE.txt`; the source
manifest verifies its exact bytes. Inputs are submitted to an actual local model;
they are not pre-generated inference results.

The following are optional local inputs and are excluded from the source export:

- `dictation-en.wav` and `dictation-correction.wav`: original demonstration
  sentences synthesized on the developer's Windows installation. The included
  `prepare-asr-audio.ps1` and `prepare-asr-correction-audio.ps1` scripts can generate
  them using an installed, licensed desktop voice. The audit has not established
  an output-redistribution grant for that voice. Its engine files are not shipped.
- `geometry-house.jpg`: a previously used reference-repository image whose
  photo-specific redistribution rights were not established. Use **Import image**
  with a photograph you can use instead.
- Historical external Chinese speech and QA audio recordings: excluded; they are
  unnecessary for the English source demonstration.

Sample buttons appear only when corresponding files are installed. Normal
packaging includes only the approved vehicle photograph. `-IncludeLocalSamples`
is an explicit option for a locally assembled demonstration; it does not grant
permission to redistribute those inputs.

Model identities and required attribution remain in technical records and legal
files. Generic interface labels do not imply that ModelConnect created the
underlying models.
