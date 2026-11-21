"""Cut the arcade art (tools/sheets/arcade_bldg.jpg, arcade_props.jpg, arcade_plush.jpg, all on magenta) into the atlas,
with the same blob cutter as add_casino.py. Existing atlas coordinates are unchanged (new sprites go below).

    python3 tools/add_arcade.py && node tools/build_snow_atlas.js
"""
import add_casino as A

A.SHEETS = {
  'arcade_bldg.jpg': [[('b_arcade', 7.4), ('b_playland', 6.2)], [('b_clawbooth', 3.4), ('b_photobooth', 2.8)]],
  'arcade_props.jpg': [
    [('ad_race', 1.7), ('ad_dance', 2.0), ('ad_hoop', 1.25), ('ad_claw', 1.45), ('ad_hockey', 2.8), ('ad_mole', 1.2)],
    [('ad_pinball', 1.1), ('ad_counter', 2.6), ('ad_token', 1.0), ('ad_neon', 2.0)],
    [('ad_ballpit', 3.8), ('ad_slide', 2.6), ('ad_cannon', 1.0), ('ad_blocks', 1.3), ('ad_blocks2', 1.0), ('ad_blocks2b', .4)],
    [('ad_mat', 1.8), ('ad_bench', 1.8)]],
  'arcade_plush.jpg': [
    [('py_bear', 1.3), ('py_bunny', 1.0), ('py_cat', 1.4), ('py_dino', 1.7), ('py_duck', 1.1)],
    [('py_panda', 1.3), ('py_cub', 1.15), ('py_star', 1.5), ('py_gold', 2.0)]],
}

if __name__ == '__main__':
    A.main()
