import { defineStore } from 'pinia'

export const useReservationStore = defineStore('reservation', {
  state: () => ({
    changeVersion: 0
  }),
  actions: {
    markChanged() {
      this.changeVersion += 1
    }
  }
})
