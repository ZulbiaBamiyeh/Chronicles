// Shared brute-force planner for the current loop: four path cards plus one
// monster sent at the rival. Days 1–4 have no duel; day 5 is the finale.

import {
  resolvePath, PATH_SLOTS, resolveAmbush, duel, resolveSendFight, ghostFighter,
  RUN_DAYS,
} from '../js/engine.js';
import { card } from '../js/cards.js';

/**
 * @param {object} run
 * @param {string[]} hand
 * @param {function} score  (state) => number
 * @param {{ rivalDay: object, rivalCombat: {hp,maxHp}, isFinale?: boolean }} ctx
 */
export function bestDay(run, hand, score, ctx) {
  const available = hand.map((id) => ({ id, from: 'hand' }));
  const monsterIdx = available
    .map((c, i) => (card(c.id)?.type === 'monster' ? i : -1))
    .filter((i) => i >= 0);

  let best = null;
  const sendChoices = monsterIdx.length ? monsterIdx : [null];

  for (const sendI of sendChoices) {
    const send = sendI == null ? null : available[sendI];
    const rest = available.filter((_, i) => i !== sendI);
    const target = Math.min(PATH_SLOTS, rest.length);
    const chosen = [];
    const used = new Set();

    const walk = () => {
      if (chosen.length === target) {
        const slots = [...chosen];
        while (slots.length < PATH_SLOTS) slots.push(null);
        let out = resolvePath(run, slots);
        let ambushDamage = 0;
        if (ctx.rivalDay.invasion) {
          const ambush = resolveAmbush(out.state, ctx.rivalDay.invasion);
          ambushDamage = ambush.damage;
          out = {
            ...out,
            state: ambush.state,
            pathDamage: out.pathDamage + ambush.damage,
            cleanPath: out.cleanPath && ambush.damage === 0,
          };
        }

        let sendDamage = 0;
        let afterHp = ctx.rivalCombat?.hp ?? ctx.rivalDay.hp;
        const themHp = ctx.rivalCombat?.hp ?? ctx.rivalDay.hp;
        const themMax = ctx.rivalCombat?.maxHp ?? ctx.rivalDay.maxHp;
        const wounded = { ...ctx.rivalDay, hp: themHp, maxHp: themMax };

        let rivalBruised = false;
        if (send) {
          const fought = resolveSendFight(ghostFighter(wounded), send.id);
          sendDamage = fought.damage;
          afterHp = fought.fighter.hp;
          wounded.hp = afterHp;
          rivalBruised = Boolean(fought.bruised);
        }

        let d = null;
        if (ctx.isFinale || run.round >= RUN_DAYS) {
          d = duel(out.state, wounded, out.cleanPath, {
            mine: out.secrets,
            theirs: ctx.rivalDay.secrets,
          });
        }

        const value = (d?.won ? 500 : 0) + score(out.state) + sendDamage * 3.2
          - ambushDamage * 0.8 + (rivalBruised ? 40 : 0) - (out.state.bruised ? 40 : 0);
        if (!best || value > best.value) {
          best = { value, slots, out, duel: d, ambushDamage, sendDamage, send, afterHp, wounded, rivalBruised };
        }
        return;
      }
      for (let i = 0; i < rest.length; i++) {
        if (used.has(i)) continue;
        used.add(i);
        chosen.push(rest[i]);
        walk();
        chosen.pop();
        used.delete(i);
      }
    };
    walk();
  }
  return best;
}
