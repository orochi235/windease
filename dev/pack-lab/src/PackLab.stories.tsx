import type { Story } from '@ladle/react';
import { PackLab } from './PackLab.js';

export default { title: 'Pack lab' };

export const Lab: Story = () => (
  <div className="pl-story">
    <PackLab />
  </div>
);
