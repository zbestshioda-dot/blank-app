"""Cut the condo art (tools/sheets/condo_bldg.jpg, condo_lobby.jpg, condo_room.jpg, condo_style.jpg, all on magenta #FF00FF)
into the atlas with the blob cutter of add_casino.py. Existing atlas coordinates are unchanged (new sprites go below).
condo_bldg.jpg is condo_full.jpg with the fire station / library the generator drew beside it painted out.

    python3 tools/add_condo.py && node tools/build_snow_atlas.js
"""
import add_casino as A

STY = ['min', 'pink', 'loft', 'thai']
A.SHEETS = {
  'condo_bldg.jpg': [[('b_condo', 6.0)]],
  'condo_lobby.jpg': [
    [('cl_counter', 3.0), ('cl_elev', 1.7), ('cl_mail', 1.9), ('cl_gate', 2.6)],
    [('cl_sofa', 2.7), ('cl_table', 1.4), ('cl_plant', 1.2), ('cl_board', 1.7)],
    [('cl_parcel', 1.8), ('cl_water', .8), ('cl_lamp', .9), ('cl_art', 1.7)]],
  'condo_room.jpg': [
    [('cu_kitchen', 2.4), ('cu_fridge', 1.0), ('cu_sbed', 2.0), ('cu_wardrobe', 1.9)],
    [('cu_window', 2.0), ('cu_balcony', 1.8), ('cu_bathdoor', 1.2), ('cu_ac', 1.6)],
    [('cu_desk', 1.6), ('cu_tv', 1.8), ('cu_dining', 2.2), ('cu_shoes', 1.4)]],
  'condo_style.jpg': [[('cs_bed_' + s, 2.3) for s in STY], [('cs_sofa_' + s, 2.1) for s in STY], [('cs_rug_' + s, 2.6) for s in STY]],
}
A.GROW['condo_bldg.jpg'] = 14      # the guard booth, planters and bike rack stand apart from the tower
A.GROW['condo_room.jpg'] = 26      # the TV hangs above its cabinet, the chairs stand apart from desk / table, the mat below the shoe rack
A.GROW['condo_lobby.jpg'] = 8

if __name__ == '__main__':
    A.main()
