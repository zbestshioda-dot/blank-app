"""Cut the bakery art (tools/sheets/bakery_bldg.jpg, bakery_props.jpg, both on magenta #FF00FF) into the atlas,
with the same blob cutter as add_casino.py. Existing atlas coordinates are unchanged (new sprites go below).
The server picks the pictures up by name (b_bakery, bk_*); until they exist older furniture stands in (data.js BKS).
Prompts for the sheets: docs/bakery_art_prompts.md

    python3 tools/add_bakery.py && node tools/build_snow_atlas.js
"""
import add_casino as A

A.SHEETS = {
  'bakery_bldg.jpg': [[('b_bakery', 5.2)]],
  'bakery_props.jpg': [
    [('bk_counter', 3.0), ('bk_cakecase', 2.2), ('bk_oven', 1.8)],
    [('bk_breadrack', 1.8), ('bk_fridge', 1.4), ('bk_display', 2.0)],
    [('bk_table', 2.4), ('bk_plant', 1.0), ('bk_sign', 2.0), ('bk_menu', 1.0)]],
}

A.GROW['bakery_props.jpg'] = 10   # the chairs stand apart from their table

if __name__ == '__main__':
    A.main()
