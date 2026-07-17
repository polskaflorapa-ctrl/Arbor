import { render, screen } from '@testing-library/react';
import BrandLogo, { BRAND_LOGOS } from './BrandLogo';

test('uses the approved light-background logo by default', () => {
  render(<BrandLogo />);

  expect(screen.getByRole('img', { name: 'Polska Flora' })).toHaveAttribute(
    'src',
    BRAND_LOGOS.light.horizontal,
  );
});

test('uses approved dark-background and compact logo variants', () => {
  const { container } = render(
    <BrandLogo background="dark" withDescriptor responsiveVertical alt="Polska Flora — Nature Integrator" />,
  );

  expect(screen.getByRole('img', { name: 'Polska Flora — Nature Integrator' })).toHaveAttribute(
    'src',
    BRAND_LOGOS.dark.withDescriptorHorizontal,
  );
  expect(container.querySelector('source')).toHaveAttribute(
    'srcset',
    BRAND_LOGOS.dark.withDescriptorVertical,
  );
});
