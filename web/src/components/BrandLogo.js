const BRAND_LOGO_BASE = '/brand/logo';

const logoPath = ({ withDescriptor, orientation, background }) => {
  const descriptor = withDescriptor ? 'with-descriptor' : 'without-descriptor';
  return `${BRAND_LOGO_BASE}/${descriptor}-${orientation}-${background}.svg`;
};

export const BRAND_LOGOS = Object.freeze({
  light: Object.freeze({
    horizontal: logoPath({ withDescriptor: false, orientation: 'horizontal', background: 'light' }),
    vertical: logoPath({ withDescriptor: false, orientation: 'vertical', background: 'light' }),
    withDescriptorHorizontal: logoPath({ withDescriptor: true, orientation: 'horizontal', background: 'light' }),
    withDescriptorVertical: logoPath({ withDescriptor: true, orientation: 'vertical', background: 'light' }),
  }),
  dark: Object.freeze({
    horizontal: logoPath({ withDescriptor: false, orientation: 'horizontal', background: 'dark' }),
    vertical: logoPath({ withDescriptor: false, orientation: 'vertical', background: 'dark' }),
    withDescriptorHorizontal: logoPath({ withDescriptor: true, orientation: 'horizontal', background: 'dark' }),
    withDescriptorVertical: logoPath({ withDescriptor: true, orientation: 'vertical', background: 'dark' }),
  }),
});

/**
 * Official Polska Flora lock-up. `background` selects the approved contrast
 * variant; `responsiveVertical` swaps to the approved vertical lock-up in a
 * narrow rail without stretching or rebuilding the mark.
 */
export default function BrandLogo({
  background = 'light',
  withDescriptor = false,
  responsiveVertical = false,
  compactBreakpoint = '900px',
  className = '',
  imageClassName = '',
  alt = 'Polska Flora',
  ...pictureProps
}) {
  const tone = background === 'dark' ? BRAND_LOGOS.dark : BRAND_LOGOS.light;
  const horizontal = withDescriptor ? tone.withDescriptorHorizontal : tone.horizontal;
  const vertical = withDescriptor ? tone.withDescriptorVertical : tone.vertical;
  const pictureClassName = ['pf-brand-picture', className].filter(Boolean).join(' ');
  const logoClassName = ['pf-brand-logo', imageClassName].filter(Boolean).join(' ');

  return (
    <picture className={pictureClassName} {...pictureProps}>
      {responsiveVertical ? <source media={`(max-width: ${compactBreakpoint})`} srcSet={vertical} /> : null}
      <img className={logoClassName} src={horizontal} alt={alt} />
    </picture>
  );
}
