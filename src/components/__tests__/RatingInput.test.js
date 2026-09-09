// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import RatingInput from '@/components/RatingInput.vue'

function starButtons(wrapper) {
  return wrapper.findAll('button.star-btn')
}

function clickStar(button, { half = false } = {}) {
  const el = button.element
  el.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 20,
    height: 20,
    right: 20,
    bottom: 20,
    x: 0,
    y: 0,
    toJSON: () => {},
  })
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: half ? 5 : 15 }))
}

describe('RatingInput', () => {
  it('emits whole stars on right-half clicks', async () => {
    const wrapper = mount(RatingInput, { props: { modelValue: null } })
    clickStar(starButtons(wrapper)[1])
    expect(wrapper.emitted('change')?.[0]).toEqual([2])
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([2])
  })

  it('emits half-steps on left-half clicks', async () => {
    const wrapper = mount(RatingInput, { props: { modelValue: null } })
    clickStar(starButtons(wrapper)[2], { half: true })
    expect(wrapper.emitted('change')?.[0]).toEqual([2.5])
  })

  it('toggles off when clicking the current value', async () => {
    const wrapper = mount(RatingInput, { props: { modelValue: 2 } })
    clickStar(starButtons(wrapper)[1])
    expect(wrapper.emitted('change')?.[0]).toEqual([null])
  })

  it('renders the half-filled star', async () => {
    const wrapper = mount(RatingInput, { props: { modelValue: 2.5 } })
    const buttons = starButtons(wrapper)
    expect(buttons[0].classes()).toContain('is-filled')
    expect(buttons[1].classes()).toContain('is-filled')
    expect(buttons[2].classes()).toContain('is-half')
    expect(wrapper.text()).toContain('2.5')
  })
})
