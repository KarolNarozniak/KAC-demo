import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApi } from '../src/app.js';
import type { ScheduleGenerationResult, PlanningContext } from '../src/scheduling/types.js';

const context: PlanningContext = {
  profile: { id: 'P1', userId: 'U1', calendarId: 'K1', timeZone: 'Europe/Warsaw', minimumHours: 4, targetHours: 8, maximumHours: 12,
    hourlyRatePln: 30, commuteBufferMinutes: 0, minimumRestMinutes: 0, mode: 'elastyczny', minimumShiftMinutes: 120, maximumSlotMinutes: 360 },
  availability: [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({ id: String(dayOfWeek), dayOfWeek, startTime: '08:00', endTime: '22:00' })),
  preferredWorkWindows: [], blockedPeriods: [], events: [], shiftTemplates: [],
};

test('schedule API generates and persists a validated weekly proposal', async () => {
  let saved: ScheduleGenerationResult | undefined;
  const app = buildApi(null, [], { scheduleRepository: {
    getPlanningContext: async () => context,
    getLatestSchedule: async () => saved ?? null,
    saveSchedule: async (_context, schedule) => { saved = { ...schedule, scheduleId: 'G1', version: (saved?.version ?? 0) + 1 }; return saved; },
  } });
  try {
    const invalid = await app.inject({ method: 'POST', url: '/api/schedules/generate', payload: { weekStart: '2026-11-03' } });
    assert.equal(invalid.statusCode, 400);
    const response = await app.inject({ method: 'POST', url: '/api/schedules/generate', payload: { weekStart: '2026-11-02' } });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().solutionStatus, 'target_met');
    assert.ok(response.json().scheduleId);
    assert.equal((await app.inject({ method: 'GET', url: '/api/schedules/2026-11-02' })).statusCode, 200);
    const current = response.json() as ScheduleGenerationResult;
    const edited = await app.inject({ method: 'PUT', url: '/api/schedules/2026-11-02', payload: {
      expectedVersion: current.version,
      shifts: current.shifts.map((shift) => ({ id: shift.candidateId, startLocal: shift.startLocal, endLocal: shift.endLocal })),
    } });
    assert.equal(edited.statusCode, 200);
    assert.equal(edited.json().version, 2);
    const invalidEdit = await app.inject({ method: 'PUT', url: '/api/schedules/2026-11-02', payload: {
      expectedVersion: 2, shifts: [{ id: 'bad', startLocal: '2026-11-02T06:00', endLocal: '2026-11-02T10:00' }],
    } });
    assert.equal(invalidEdit.statusCode, 422);
  } finally { await app.close(); }
});
