import { AIProjectClient } from '@azure/ai-projects';
import { AzureCliCredential } from '@azure/identity';
import { config } from '../src/config.js';

if (!config.azureAi.projectEndpoint || !config.azureAi.agentName) throw new Error('Set AZURE_AI_PROJECT_ENDPOINT and AZURE_AI_AGENT_NAME first.');
const project = new AIProjectClient(config.azureAi.projectEndpoint, new AzureCliCredential());
const agent = await project.agents.get(config.azureAi.agentName);
const deployments = [];
for await (const deployment of project.deployments.list()) {
  deployments.push({ name: deployment.name, type: deployment.type,
    modelName: deployment.type === 'ModelDeployment' ? deployment.modelName : undefined,
    modelVersion: deployment.type === 'ModelDeployment' ? deployment.modelVersion : undefined,
    capabilities: deployment.type === 'ModelDeployment' ? deployment.capabilities : undefined,
    sku: deployment.type === 'ModelDeployment' ? deployment.sku : undefined });
}
console.log(JSON.stringify({ previewAgent: { name: agent.name, keys: Object.keys(agent) }, deployments }, null, 2));
