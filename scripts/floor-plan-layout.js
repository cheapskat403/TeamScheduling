/**
 * Desk layout for the office floor plan drawing (public/floorplans/jhb-floor-plan.svg).
 *
 * The drawing is shown on the map canvas at 800px tall (the SVG is 1780.45 x 2500). Desk positions
 * were measured from the reference image of the bookable desks and converted into that canvas.
 * Pure functions, no database access, so the layout can be tested.
 */

// Reference image pixels -> SVG units -> map canvas
const S = 2.745;
const OX = -58;
const OY = -29;
const K = 800 / 2500;
const toCanvas = (px, py) => ({ x: (OX + S * px) * K, y: (OY + S * py) * K });

/** Background drawing for the floor: shown behind the desks */
const UNDERLAY = {
    url: '/floorplans/jhb-floor-plan.svg',
    x: 0,
    y: 0,
    width: Math.round(1780.45 * 800 / 2500),
    height: 800
};

const OPEN_PLAN = { w: 28, h: 12, colPitch: 31, rowPitch: 13 };
const TALL = { w: 14, h: 30 };

// Three back-to-back blocks of 2 rows x 4 desks, measured from the reference image (row top, in image px)
const OPEN_PLAN_BLOCKS = [
    { rowTopPx: 294, top: ['A21', 'A22', 'A23', 'A24'], bottom: ['A17', 'A18', 'A19', 'A20'] },
    { rowTopPx: 392, top: ['A13', 'A14', 'A15', 'A16'], bottom: ['A09', 'A10', 'A11', 'A12'] },
    { rowTopPx: 559, top: ['A05', 'A06', 'A07', 'A08'], bottom: ['A01', 'A02', 'A03', 'A04'] }
];

/**
 * @param {{location?: string, floor?: string}} options
 * @returns {Array<object>} desk rows ready to insert into the `desks` table
 */
function buildDesks({ location = 'jhb', floor = '1' } = {}) {
    const desks = [];
    const add = (name, zone, cx, cy, w, h, chairs) => desks.push({
        id: `${location}-${name.toLowerCase()}`,
        name,
        location_id: location,
        floor,
        zone,
        x: Math.round(cx - w / 2),
        y: Math.round(cy - h / 2),
        width: w,
        height: h,
        desk_type: 'hotseat',
        assigned_team_id: null,
        chair_positions: chairs,
        qr_code: `${location}-${name.toLowerCase()}-${Math.random().toString(36).slice(2, 10)}`
    });

    // Open Plan
    const blockCenterX = toCanvas(38 + 26 / 2 + 1.5 * (71 - 38), 0).x;
    OPEN_PLAN_BLOCKS.forEach(block => {
        const blockCenterY = toCanvas(0, block.rowTopPx + 13 / 2 + 6).y;
        const topRowY = blockCenterY - OPEN_PLAN.rowPitch / 2;
        [[block.top, topRowY, ['top']], [block.bottom, topRowY + OPEN_PLAN.rowPitch, ['bottom']]].forEach(([names, cy, chairs]) => {
            names.forEach((name, col) => {
                add(name, 'Open Plan', blockCenterX + (col - 1.5) * OPEN_PLAN.colPitch, cy, OPEN_PLAN.w, OPEN_PLAN.h, chairs);
            });
        });
    });

    // First Insurance: three stacks of two vertical desks. These positions are as adjusted by hand in
    // Edit Layout (the middle stack faces the other way, so its chairs are on the right).
    [
        ['QZ-03', 470, 12, 'left'], ['QZ-04', 470, 44, 'left'],
        ['QZ-05', 415, 12, 'right'], ['QZ-06', 415, 43, 'right'],
        ['QZ-07', 399, 11, 'left'], ['QZ-08', 399, 43, 'left']
    ].forEach(([name, x, y, chair]) => {
        add(name, 'First Insurance', x + TALL.w / 2, y + TALL.h / 2, TALL.w, TALL.h, [chair]);
    });

    // The two single desks beside the meeting room, chairs on the right
    const sm1 = toCanvas(231, 284.5);
    const sm2 = toCanvas(231, 344.5);
    add('SM01', 'SM Room', sm1.x, sm1.y, TALL.w, TALL.h, ['right']);
    add('SM02', 'SM Room', sm2.x, sm2.y, TALL.w, TALL.h, ['right']);

    return desks;
}

module.exports = { buildDesks, UNDERLAY };
