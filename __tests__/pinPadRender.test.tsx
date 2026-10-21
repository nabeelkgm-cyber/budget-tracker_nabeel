import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { PinPad } from '@/components/PinPad';

describe('PinPad', () => {
  const press = (tree: TestRenderer.ReactTestRenderer, label: string) => {
    const btn = tree.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
    act(() => btn.props.onPress());
  };

  it('adds digits up to the length, and deletes', () => {
    const changes: string[] = [];
    let value = '';
    const render = () => <PinPad value={value} length={4} onChange={(v) => { value = v; changes.push(v); }} />;
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => { tree = TestRenderer.create(render()); });
    press(tree, '4');
    act(() => tree.update(render()));
    press(tree, '8');
    act(() => tree.update(render()));
    press(tree, 'Delete');
    expect(changes).toEqual(['4', '48', '4']);
  });

  it('ignores presses beyond the length and while disabled', () => {
    const onChange = jest.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<PinPad value="1234" length={4} onChange={onChange} />); });
    press(tree, '5');
    expect(onChange).not.toHaveBeenCalled();
    act(() => tree.update(<PinPad value="" length={4} onChange={onChange} disabled />));
    press(tree, '5');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('draws one dot per digit of the PIN length', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<PinPad value="12" length={6} onChange={() => {}} />); });
    const dots = tree.root.findAll((n) => (n.type as unknown) === 'View' && n.props.style && n.props.style.width === 16 && n.props.style.height === 16);
    expect(dots.length).toBe(6);
  });
});
