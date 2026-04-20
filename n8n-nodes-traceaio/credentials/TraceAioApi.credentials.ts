import { ICredentialType, INodeProperties } from 'n8n-workflow';

export class TraceAioApi implements ICredentialType {
	name = 'traceAioApi';
	displayName = 'TraceAIO API';
	documentationUrl = 'https://github.com/jakubsuchy/traceaio';

	properties: INodeProperties[] = [
		{
			displayName: 'Instance URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://localhost:3000',
			placeholder: 'https://traceaio.example.com',
			required: true,
			description: 'The URL of your TraceAIO instance',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Generate an API key from the TraceAIO sidebar → "Chat with your data" → Generate API Key',
		},
	];
}
