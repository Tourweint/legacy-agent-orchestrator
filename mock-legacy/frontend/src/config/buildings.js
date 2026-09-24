import { reactive } from 'vue'
import { classroomApi } from '../api'

const BUILDING_CACHE_KEY = 'campus_reservation_buildings'
const BUILDING_CACHE_TTL = 24 * 60 * 60 * 1000

export const buildingOptions = reactive([])

let cachedAt = 0
let loadingPromise = null

function normalizeBuildingOptions(buildings) {
  const values = [...new Set(
    (buildings || [])
      .map(item => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
  )]

  return values.map(value => ({
    label: value,
    value
  }))
}

function applyBuildingOptions(options, nextCachedAt = Date.now()) {
  buildingOptions.splice(0, buildingOptions.length, ...options)
  cachedAt = nextCachedAt
}

function readCachedBuildings() {
  const raw = localStorage.getItem(BUILDING_CACHE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw)
    const options = normalizeBuildingOptions(parsed?.options?.map(item => item?.value || item?.label || item))
    if (!options.length) {
      localStorage.removeItem(BUILDING_CACHE_KEY)
      return null
    }
    return {
      cachedAt: Number(parsed?.cachedAt) || 0,
      options
    }
  } catch {
    localStorage.removeItem(BUILDING_CACHE_KEY)
    return null
  }
}

function writeCachedBuildings(options) {
  localStorage.setItem(BUILDING_CACHE_KEY, JSON.stringify({
    cachedAt: Date.now(),
    options
  }))
}

function shouldUseMemoryCache(forceRefresh) {
  return !forceRefresh && buildingOptions.length > 0 && Date.now() - cachedAt < BUILDING_CACHE_TTL
}

const cachedBuildings = readCachedBuildings()
if (cachedBuildings?.options?.length) {
  applyBuildingOptions(cachedBuildings.options, cachedBuildings.cachedAt)
}

export function getDefaultBuildingValue() {
  return buildingOptions[0]?.value || ''
}

export function hasBuildingOption(value) {
  return buildingOptions.some(item => item.value === value)
}

export async function ensureBuildingOptionsLoaded(options = {}) {
  const { forceRefresh = false } = options
  if (shouldUseMemoryCache(forceRefresh)) {
    return buildingOptions
  }

  if (loadingPromise) {
    return loadingPromise
  }

  loadingPromise = classroomApi.buildings()
    .then(data => {
      const nextOptions = normalizeBuildingOptions(data)
      applyBuildingOptions(nextOptions)
      writeCachedBuildings(nextOptions)
      return buildingOptions
    })
    .catch(error => {
      if (buildingOptions.length > 0) {
        return buildingOptions
      }
      throw error
    })
    .finally(() => {
      loadingPromise = null
    })

  return loadingPromise
}

export function refreshBuildingOptions() {
  return ensureBuildingOptionsLoaded({ forceRefresh: true })
}
