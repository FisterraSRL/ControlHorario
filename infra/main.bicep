targetScope = 'resourceGroup'

@description('Nombre global de la Web App de ControlHorario.')
param webAppName string = 'controlhorario-fisterra'

@description('App Service Plan Linux B1 existente. Esta plantilla nunca crea un plan.')
param existingPlanName string = 'ASP-fisterrasrlgroup-9f1d'

@description('Debe coincidir con la región del App Service Plan existente.')
param location string = 'westus3'

resource existingPlan 'Microsoft.Web/serverfarms@2024-04-01' existing = {
  name: existingPlanName
}

resource webApp 'Microsoft.Web/sites@2024-04-01' = {
  name: webAppName
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: existingPlan.id
    httpsOnly: true
    clientAffinityEnabled: false
    publicNetworkAccess: 'Enabled'
    siteConfig: {
      linuxFxVersion: 'NODE|24-lts'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      http20Enabled: true
      healthCheckPath: '/health'
      appCommandLine: 'npm run api'
      appSettings: [
        {
          name: 'NODE_ENV'
          value: 'production'
        }
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'true'
        }
        {
          name: 'ENABLE_ORYX_BUILD'
          value: 'true'
        }
        {
          name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE'
          value: 'true'
        }
        {
          name: 'API_HOST'
          value: '0.0.0.0'
        }
        {
          name: 'VITE_API_BASE_URL'
          value: '/api'
        }
        {
          name: 'API_NIVEL_LOG'
          value: 'info'
        }
        {
          name: 'API_MIGRAR_AL_INICIAR'
          value: 'false'
        }
        {
          name: 'API_DIR_ESTATICO'
          value: 'dist'
        }
        {
          name: 'API_DIR_MIGRACIONES'
          value: 'db/migrations'
        }
        {
          name: 'API_DIR_ADJUNTOS'
          value: '/home/controlhorario/adjuntos'
        }
        {
          name: 'API_COOKIE_SEGURA'
          value: 'true'
        }
        {
          name: 'API_COOKIE_SAMESITE'
          value: 'lax'
        }
        {
          name: 'APP_ORIGEN_FRONTEND'
          value: ''
        }
        {
          name: 'APP_URL_PUBLICA'
          value: 'https://${webAppName}.azurewebsites.net'
        }
        {
          name: 'DB_PORT'
          value: '1433'
        }
        {
          name: 'DB_MAX_CONEXIONES'
          value: '5'
        }
        {
          name: 'API_OPERADOR'
          value: 'servidor'
        }
      ]
    }
  }
}

resource ftpCredentials 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-04-01' = {
  parent: webApp
  name: 'ftp'
  properties: {
    allow: false
  }
}

resource scmCredentials 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-04-01' = {
  parent: webApp
  name: 'scm'
  properties: {
    allow: false
  }
}

output webAppHostName string = '${webAppName}.azurewebsites.net'
output existingPlanResourceId string = existingPlan.id
