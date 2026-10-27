/**
 * The desk layout for the floor plan drawing.
 */
const { buildDesks, UNDERLAY } = require('../../scripts/floor-plan-layout');

describe('floor plan desk layout', () => {
    const desks = buildDesks({ location: 'jhb', floor: '1' });

    test('creates the 32 desks the office uses', () => {
        expect(desks).toHaveLength(32);
        const names = desks.map(d => d.name);
        expect(names.filter(n => /^A\d\d$/.test(n))).toHaveLength(24);
        expect(names).toEqual(expect.arrayContaining(['QZ-03', 'QZ-04', 'QZ-05', 'QZ-06', 'QZ-07', 'QZ-08', 'SM01', 'SM02']));
    });

    test('ids, names and QR codes are unique', () => {
        for (const field of ['id', 'name', 'qr_code']) {
            expect(new Set(desks.map(d => d[field])).size).toBe(desks.length);
        }
    });

    test('every desk is on the requested floor and location', () => {
        expect(desks.every(d => d.floor === '1' && d.location_id === 'jhb')).toBe(true);
    });

    test('desks never overlap each other', () => {
        const overlaps = [];
        for (let i = 0; i < desks.length; i++) {
            for (let j = i + 1; j < desks.length; j++) {
                const a = desks[i], b = desks[j];
                if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) {
                    overlaps.push(`${a.name}/${b.name}`);
                }
            }
        }
        expect(overlaps).toEqual([]);
    });

    test('every desk sits inside the drawing', () => {
        const outside = desks.filter(d =>
            d.x < UNDERLAY.x || d.y < UNDERLAY.y ||
            d.x + d.width > UNDERLAY.x + UNDERLAY.width || d.y + d.height > UNDERLAY.y + UNDERLAY.height);
        expect(outside.map(d => d.name)).toEqual([]);
    });

    test('values fit the database: integer positions and sizes, known chair sides', () => {
        const sides = ['top', 'bottom', 'left', 'right'];
        for (const d of desks) {
            for (const field of ['x', 'y', 'width', 'height']) expect(Number.isInteger(d[field])).toBe(true);
            expect(d.chair_positions.every(c => sides.includes(c))).toBe(true);
            expect(d.desk_type).toBe('hotseat');
        }
    });

    test('Open Plan rows have chairs on the outside: top row up, bottom row down', () => {
        expect(desks.find(d => d.name === 'A21').chair_positions).toEqual(['top']);
        expect(desks.find(d => d.name === 'A17').chair_positions).toEqual(['bottom']);
    });

    test('the background points at a file that exists', () => {
        const fs = require('fs');
        const path = require('path');
        expect(fs.existsSync(path.join(__dirname, '..', '..', 'public', UNDERLAY.url))).toBe(true);
    });
});
