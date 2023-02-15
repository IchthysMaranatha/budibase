import { writable, get } from "svelte/store"
import { API } from "api"
import { cloneDeep } from "lodash/fp"
import { generate } from "shortid"
import { selectedAutomation } from "builderStore"

const initialAutomationState = {
  automations: [],
  testResults: null,
  showTestPanel: false,
  blockDefinitions: {
    TRIGGER: [],
    ACTION: [],
  },
  selectedAutomationId: null,
}

export const getAutomationStore = () => {
  const store = writable(initialAutomationState)
  store.actions = automationActions(store)
  return store
}

const automationActions = store => ({
  definitions: async () => {
    const response = await API.getAutomationDefinitions()
    store.update(state => {
      state.blockDefinitions = {
        TRIGGER: response.trigger,
        ACTION: response.action,
      }
      return state
    })
    return response
  },
  fetch: async () => {
    const responses = await Promise.all([
      API.getAutomations(),
      API.getAutomationDefinitions(),
    ])
    store.update(state => {
      state.automations = responses[0]
      state.blockDefinitions = {
        TRIGGER: responses[1].trigger,
        ACTION: responses[1].action,
      }
      return state
    })
  },
  create: async (name, trigger) => {
    const automation = {
      name,
      type: "automation",
      definition: {
        steps: [],
        trigger,
      },
    }
    const response = await store.actions.save(automation)
    store.actions.select(response._id)
    return response
  },
  duplicate: async automation => {
    const response = await store.actions.save({
      ...automation,
      name: `${automation.name} - copy`,
      _id: undefined,
      _ref: undefined,
    })
    store.actions.select(response._id)
    return response
  },
  save: async automation => {
    const response = await API.updateAutomation(automation)
    store.update(state => {
      const updatedAutomation = response.automation
      const existingIdx = state.automations.findIndex(
        existing => existing._id === automation._id
      )
      if (existingIdx !== -1) {
        state.automations.splice(existingIdx, 1, updatedAutomation)
        return state
      } else {
        state.automations = [...state.automations, updatedAutomation]
      }
      return state
    })
    return response.automation
  },
  delete: async automation => {
    await API.deleteAutomation({
      automationId: automation?._id,
      automationRev: automation?._rev,
    })
    store.update(state => {
      // Remove the automation
      state.automations = state.automations.filter(
        x => x._id !== automation._id
      )
      // Select a new automation if required
      if (automation._id === state.selectedAutomationId) {
        state.selectedAutomationId = state.automations[0]?._id
      }
      return state
    })
  },
  updateBlockInputs: async (block, data) => {
    let newBlock = {
      ...block,
      inputs: {
        ...block.inputs,
        ...data,
      },
    }
    const automation = get(selectedAutomation)
    let newAutomation = cloneDeep(automation)
    if (automation.definition.trigger?.id === block.id) {
      newAutomation.definition.trigger = newBlock
    } else {
      const idx = automation.definition.steps.findIndex(x => x.id === block.id)
      newAutomation.definition.steps.splice(idx, 1, newBlock)
    }
    await store.actions.save(newAutomation)
  },
  test: async (automation, testData) => {
    const result = await API.testAutomation({
      automationId: automation?._id,
      testData,
    })
    store.update(state => {
      state.testResults = result
      return state
    })
  },
  getDefinition: id => {
    return get(store).automations?.find(x => x._id === id)
  },
  select: id => {
    if (!id) {
      return
    }
    store.update(state => {
      state.selectedAutomationId = id
      return state
    })
  },
  getLogs: async ({ automationId, startDate, status, page } = {}) => {
    return await API.getAutomationLogs({
      automationId,
      startDate,
      status,
      page,
    })
  },
  clearLogErrors: async ({ automationId, appId } = {}) => {
    return await API.clearAutomationLogErrors({
      automationId,
      appId,
    })
  },
  addTestDataToAutomation: async data => {
    let newAutomation = cloneDeep(get(selectedAutomation))
    newAutomation.testData = {
      ...newAutomation.testData,
      ...data,
    }
    await store.actions.save(newAutomation)
  },
  constructBlock(type, stepId, blockDefinition) {
    return {
      ...blockDefinition,
      inputs: blockDefinition.inputs || {},
      stepId,
      type,
      id: generate(),
    }
  },
  addBlockToAutomation: async (block, blockIdx) => {
    const automation = get(selectedAutomation)
    let newAutomation = cloneDeep(automation)
    if (!automation) {
      return
    }
    newAutomation.definition.steps.splice(blockIdx, 0, block)
    await store.actions.save(newAutomation)
  },
  toggleFieldControl: value => {
    store.update(state => {
      state.selectedBlock.rowControl = value
      return state
    })
  },
  deleteAutomationBlock: async block => {
    const automation = get(selectedAutomation)
    let newAutomation = cloneDeep(automation)

    // Delete trigger if required
    if (newAutomation.definition.trigger?.id === block.id) {
      delete newAutomation.definition.trigger
    } else {
      // Otherwise remove step
      newAutomation.definition.steps = newAutomation.definition.steps.filter(
        step => step.id !== block.id
      )
    }
    await store.actions.save(newAutomation)
  },
})
