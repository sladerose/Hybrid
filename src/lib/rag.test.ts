import { describe, expect, it } from 'vitest'
import {
  RAG,
  RAG_BG,
  bodyBatteryColor,
  rhrColor,
  sleepColor,
  sleepDeepColor,
  sleepRemColor,
  stressColor,
  cadenceColor,
  run5kColor,
  bodyFatColor,
  visceralFatColor,
  metabolicAgeColor,
  vigorousMinsColor,
  vigorousMinsBg,
  sessionRatingColor,
} from './rag'

describe('rag color thresholds', () => {
  // higher-is-better functions: [fn, green-value, amber-value, red-value, greenBoundary, amberBoundary]
  it('bodyBatteryColor: higher is better (green >=65, amber >=45, red below)', () => {
    expect(bodyBatteryColor(null)).toBe(RAG.neutral)
    expect(bodyBatteryColor(undefined)).toBe(RAG.neutral)
    expect(bodyBatteryColor(80)).toBe(RAG.green)
    expect(bodyBatteryColor(65)).toBe(RAG.green) // boundary
    expect(bodyBatteryColor(64)).toBe(RAG.amber) // one below boundary
    expect(bodyBatteryColor(50)).toBe(RAG.amber)
    expect(bodyBatteryColor(45)).toBe(RAG.amber) // boundary
    expect(bodyBatteryColor(44)).toBe(RAG.red) // one below boundary
    expect(bodyBatteryColor(0)).toBe(RAG.red)
  })

  it('rhrColor: lower is better (green <=52, amber <=56, red above)', () => {
    expect(rhrColor(null)).toBe(RAG.neutral)
    expect(rhrColor(48)).toBe(RAG.green)
    expect(rhrColor(52)).toBe(RAG.green) // boundary
    expect(rhrColor(53)).toBe(RAG.amber) // one above boundary
    expect(rhrColor(56)).toBe(RAG.amber) // boundary
    expect(rhrColor(57)).toBe(RAG.red) // one above boundary
    expect(rhrColor(70)).toBe(RAG.red)
  })

  it('sleepColor: more is better (green >=7, amber >=6, red below)', () => {
    expect(sleepColor(null)).toBe(RAG.neutral)
    expect(sleepColor(8)).toBe(RAG.green)
    expect(sleepColor(7)).toBe(RAG.green) // boundary
    expect(sleepColor(6.9)).toBe(RAG.amber)
    expect(sleepColor(6)).toBe(RAG.amber) // boundary
    expect(sleepColor(5.9)).toBe(RAG.red)
  })

  it('sleepDeepColor: more is better (green >=15, amber >=10, red below)', () => {
    expect(sleepDeepColor(null)).toBe(RAG.neutral)
    expect(sleepDeepColor(20)).toBe(RAG.green)
    expect(sleepDeepColor(15)).toBe(RAG.green)
    expect(sleepDeepColor(14)).toBe(RAG.amber)
    expect(sleepDeepColor(10)).toBe(RAG.amber)
    expect(sleepDeepColor(9)).toBe(RAG.red)
  })

  it('sleepRemColor: more is better (green >=20, amber >=15, red below)', () => {
    expect(sleepRemColor(null)).toBe(RAG.neutral)
    expect(sleepRemColor(25)).toBe(RAG.green)
    expect(sleepRemColor(20)).toBe(RAG.green)
    expect(sleepRemColor(19)).toBe(RAG.amber)
    expect(sleepRemColor(15)).toBe(RAG.amber)
    expect(sleepRemColor(14)).toBe(RAG.red)
  })

  it('stressColor: lower is better (green <=35, amber <=50, red above)', () => {
    expect(stressColor(null)).toBe(RAG.neutral)
    expect(stressColor(20)).toBe(RAG.green)
    expect(stressColor(35)).toBe(RAG.green)
    expect(stressColor(36)).toBe(RAG.amber)
    expect(stressColor(50)).toBe(RAG.amber)
    expect(stressColor(51)).toBe(RAG.red)
  })

  it('cadenceColor: higher is better (green >=85, amber >=78, red below)', () => {
    expect(cadenceColor(null)).toBe(RAG.neutral)
    expect(cadenceColor(90)).toBe(RAG.green)
    expect(cadenceColor(85)).toBe(RAG.green)
    expect(cadenceColor(84)).toBe(RAG.amber)
    expect(cadenceColor(78)).toBe(RAG.amber)
    expect(cadenceColor(77)).toBe(RAG.red)
  })

  it('run5kColor: lower is better (green <=1500, amber <=1800, red above)', () => {
    expect(run5kColor(null)).toBe(RAG.neutral)
    expect(run5kColor(1400)).toBe(RAG.green)
    expect(run5kColor(1500)).toBe(RAG.green)
    expect(run5kColor(1501)).toBe(RAG.amber)
    expect(run5kColor(1800)).toBe(RAG.amber)
    expect(run5kColor(1801)).toBe(RAG.red)
  })

  it('bodyFatColor: lower is better (green <=18, amber <=22, red above)', () => {
    expect(bodyFatColor(null)).toBe(RAG.neutral)
    expect(bodyFatColor(15)).toBe(RAG.green)
    expect(bodyFatColor(18)).toBe(RAG.green)
    expect(bodyFatColor(19)).toBe(RAG.amber)
    expect(bodyFatColor(22)).toBe(RAG.amber)
    expect(bodyFatColor(23)).toBe(RAG.red)
  })

  it('visceralFatColor: lower is better (green <9, amber <12, red >=12)', () => {
    expect(visceralFatColor(null)).toBe(RAG.neutral)
    expect(visceralFatColor(5)).toBe(RAG.green)
    expect(visceralFatColor(8)).toBe(RAG.green)
    expect(visceralFatColor(9)).toBe(RAG.amber) // strictly-less boundary: 9 is NOT green
    expect(visceralFatColor(11)).toBe(RAG.amber)
    expect(visceralFatColor(12)).toBe(RAG.red) // strictly-less boundary: 12 is red
    expect(visceralFatColor(15)).toBe(RAG.red)
  })

  it('metabolicAgeColor: lower is better (green <=28, amber <=33, red above)', () => {
    expect(metabolicAgeColor(null)).toBe(RAG.neutral)
    expect(metabolicAgeColor(25)).toBe(RAG.green)
    expect(metabolicAgeColor(28)).toBe(RAG.green)
    expect(metabolicAgeColor(29)).toBe(RAG.amber)
    expect(metabolicAgeColor(33)).toBe(RAG.amber)
    expect(metabolicAgeColor(34)).toBe(RAG.red)
  })

  it('vigorousMinsColor: higher is better (green >=150, amber >=75, red below)', () => {
    expect(vigorousMinsColor(null)).toBe(RAG.neutral)
    expect(vigorousMinsColor(200)).toBe(RAG.green)
    expect(vigorousMinsColor(150)).toBe(RAG.green)
    expect(vigorousMinsColor(149)).toBe(RAG.amber)
    expect(vigorousMinsColor(75)).toBe(RAG.amber)
    expect(vigorousMinsColor(74)).toBe(RAG.red)
  })

  it('vigorousMinsBg mirrors vigorousMinsColor thresholds but returns bg classes', () => {
    expect(vigorousMinsBg(null)).toBe(RAG_BG.neutral)
    expect(vigorousMinsBg(200)).toBe(RAG_BG.green)
    expect(vigorousMinsBg(150)).toBe(RAG_BG.green)
    expect(vigorousMinsBg(100)).toBe(RAG_BG.amber)
    expect(vigorousMinsBg(75)).toBe(RAG_BG.amber)
    expect(vigorousMinsBg(50)).toBe(RAG_BG.red)
  })

  it('sessionRatingColor: higher is better (green >=4, amber >=3, red below)', () => {
    expect(sessionRatingColor(null)).toBe(RAG.neutral)
    expect(sessionRatingColor(5)).toBe(RAG.green)
    expect(sessionRatingColor(4)).toBe(RAG.green)
    expect(sessionRatingColor(3)).toBe(RAG.amber)
    expect(sessionRatingColor(2)).toBe(RAG.red)
    expect(sessionRatingColor(1)).toBe(RAG.red)
  })
})
