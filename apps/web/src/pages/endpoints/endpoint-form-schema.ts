import { endpointUpdateSchema, setEndpointProvidersSchema, type EndpointDto } from '@mcproute/shared';
import { z } from 'zod';

/** The endpoint's own fields (shared schema, all required) plus its provider links. */
export const endpointFormSchema = endpointUpdateSchema.required().extend({
  providers: setEndpointProvidersSchema.shape.providers,
});

export type EndpointFormValues = z.input<typeof endpointFormSchema>;
export type EndpointFormOutput = z.output<typeof endpointFormSchema>;

export const ENDPOINT_FORM_FIELDS = Object.keys(endpointFormSchema.shape);

export function defaultEndpointValues(): EndpointFormValues {
  return { name: '', slug: '', description: '', toolPrefixMode: 'none', enableSse: false, enabled: true, providers: [] };
}

export function endpointToFormValues(endpoint: EndpointDto): EndpointFormValues {
  return {
    name: endpoint.name,
    slug: endpoint.slug,
    description: endpoint.description ?? '',
    toolPrefixMode: endpoint.toolPrefixMode,
    enableSse: endpoint.enableSse,
    enabled: endpoint.enabled,
    providers: endpoint.providers.map((link) => ({
      providerId: link.providerId,
      toolFilterMode: link.toolFilterMode,
      toolNames: [...link.toolNames],
    })),
  };
}
