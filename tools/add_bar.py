"""Cut the night-bar art (tools/sheets/bar_bldg.jpg, bar_props.jpg, both on magenta #FF00FF) into the atlas,
with the same blob cutter as add_casino.py. Existing atlas coordinates are unchanged (new sprites go below).
The server picks the pictures up by name (b_bar, br_*); until they exist older furniture stands in (data.js BRS).
Prompts for the two sheets: docs/bar_art_prompts.md

    python3 tools/add_bar.py && node tools/build_snow_atlas.js
"""
import add_casino as A

A.SHEETS = {
  'bar_bldg.jpg': [[('b_bar', 5.6)]],
  'bar_props.jpg': [
    [('br_counter', 4.2), ('br_shelf', 2.6), ('br_fridge', 1.5), ('br_tap', 1.0)],
    [('br_stool', .8), ('br_table', 2.2), ('br_sofa', 2.6), ('br_pool', 3.6)],
    [('br_stage', 3.2), ('br_mic', .7), ('br_speaker', 1.0), ('br_neon', 2.4)],
    [('br_dart', 1.0), ('br_lamp', .9), ('br_barrel', 1.0)]],
}

if __name__ == '__main__':
    A.main()
