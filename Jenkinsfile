#!/usr/bin/env groovy

// Label will be set to the Jenkins BUILD_TAG aka ${JOB_NAME}-${BUILD_NUMBER}
// also removes problematic slashes and special characters to avoid problems
// with accessing the containers
// We prepend the "AK_" prefix to avoid special characters as first char.
String label = "AK_" + env.BUILD_TAG.replace("/", "_").replace("%2F", "_").replace("-", "_").replaceAll(" ", "").reverse().take(60).reverse()
String cacheMountPath = "/root/maven-cache" // TODO: WRONG

// Don't change this line
String currentStage = 'Setup'

class KubeConfig {
    static String registryRepository = "education/warp"
    static String registryUrl = "businessschool.azurecr.io"
    static String buildSystemACR = "buildsystem.azurecr.io"

    static String kubectlImage = "devops/kubectl"
    static String kubectlImageTag = "latest"
    static String kubernetesService = "warp"
}

class NotificationProperties {
    static String serviceName = "warp"
}

enum Environment {
    DEVELOPMENT('development', 'Dev', 'lae-development', 'kubeconfig-lae-development-azure-cicd', 'development-languages'),
    TESTING('testing', 'Test', 'lae-testing', 'kubeconfig-lae-testing-azure-cicd', 'development-languages'),
    STAGING('staging', 'Stage', 'lae-staging', 'kubeconfig-lae-staging-azure-cicd', 'production-languages'),
    PRODUCTION('production', 'Prod', 'lae-production', 'kubeconfig-lae-production-azure-cicd', 'production-languages')

    final String fileDirectory
    final String shortName
    final String kubernetesNamespace
    final String kubernetesCredentials
    final String kubernetesCluster

    Environment(String fileDirectory, String shortName, String kubernetesNamespace, String kubernetesCredentials, String kubernetesCluster) {
        this.fileDirectory = fileDirectory
        this.shortName = shortName
        this.kubernetesNamespace = kubernetesNamespace
        this.kubernetesCredentials = kubernetesCredentials
        this.kubernetesCluster = kubernetesCluster
    }
}

boolean deployDevelopment = true //env.BRANCH_NAME == 'master'
boolean deployTesting     = false
boolean deployStaging     = false
boolean deployProduction  = env.TAG_NAME != null && env.TAG_NAME.startsWith('release-')
boolean deploy = deployDevelopment || deployTesting || deployStaging || deployProduction
boolean shouldBuildArtifact = deployDevelopment || deployTesting || (deployStaging && env.TAG_NAME.endsWith('-hotfix'))



properties([
    // adjust thresholds as needed, but try to keep it as low as possible. This is already a good configuration.
    buildDiscarder(logRotator(artifactDaysToKeepStr: '100', artifactNumToKeepStr: '10', daysToKeepStr: '100', numToKeepStr: '10')),
    // disableConcurrentBuilds is mandatory when using Kubernetes or you should risk to broke everything
    disableConcurrentBuilds(),
    // this options force Jenkins to keep in memory build logs until the build is done
    durabilityHint('PERFORMANCE_OPTIMIZED'),
    // limit to 4 builds per hour, but also allow users to manually start the build
    [$class: 'JobPropertyImpl', throttle: [count: 4, durationName: 'hour', userBoost: true]]
])

String imageTag = ''

///////// Pipeline starts here /////////

timeout(time: 30, unit: 'MINUTES') {
    timestamps {
        podTemplate(
                label: label,
                cloud: 'k8s-ci-cd',
                namespace: 'lae-jenkins',
                inheritFrom: 'pod-base-configuration-with-dind',
                containers: [
                        containerTemplate(
                                name: 'python',
                                image: 'python:3.13',
                                ttyEnabled: true,
                                command: 'cat',
                                resourceLimitCpu: '500m',
                                resourceLimitMemory: '2Gi',
                                alwaysPullImage: false)
                ],
                volumes: [
                        persistentVolumeClaim(claimName: "maven-cache-repo-pvc", mountPath: cacheMountPath)
                ],
                envVars: [
                        envVar(key: 'BRANCH_NAME', value: env.BRANCH_NAME),
                        envVar(key: 'MAVEN_CACHE_REPO', value: cacheMountPath)
                ]) {
            node(label) {
                stage('Checkout') {
                    currentStage = 'Checkout'
                    checkout scm
                    imageTag = buildImageTag()
                }

                if (deploy) {
                    if (shouldBuildArtifact) {
                        //buildArtifact()
                        buildAndPushImageStage(imageTag)
                    }

                    if (deployDevelopment) {
                        deployToDevEnv(imageTag)
                    }
                    if (deployTesting) {
                        deployToTestEnv(imageTag)
                    }

                    try {
                        if (deployStaging) {
                            deployToStagingEnv(imageTag)
                        }
                        if (deployProduction) {
                            deployToProdEnv(imageTag)
                        }
                    } catch (Throwable e) {
                        notifyFailedBuild(e)
                        throw e
                    }
                } else {
                    runTests()
                    validateAllK8sConfigs(imageTag)
                }
            }
        }
    }
}

///////// Stages /////////

def deployToDevEnv(String imageTag) {
    def environment = Environment.DEVELOPMENT
    stage('Deploy Dev') {
        currentStage = 'Deploy Dev'
        deploy(environment, imageTag)
    }
}

def deployToTestEnv(String imageTag) {
    def environment = Environment.TESTING
    stage('Deploy Test') {
        currentStage = 'Deploy Test'
        deploy(environment, imageTag)
    }
}

def deployToStagingEnv(String imageTag) {
    def environment = Environment.STAGING
    stage('Deploy Staging') {
        currentStage = 'Deploy Staging'
        deploy(environment, imageTag)
    }
    notifySuccessfulDeploy(environment)
}

def deployToProdEnv(String imageTag) {
    def environment = Environment.PRODUCTION
    stage('Deploy Production') {
        currentStage = 'Deploy Production'
        deploy(environment, imageTag)
    }
    notifySuccessfulDeploy(environment)
}

def buildAndPushImageStage(String imageTag) {
    stage('Build and Push Docker Image') {
        currentStage = 'Build and Push Docker Image'
        container('docker') {
            withCredentials([[$class          : 'UsernamePasswordMultiBinding',
                              credentialsId   : KubeConfig.registryUrl,
                              usernameVariable: 'registryUser',
                              passwordVariable: 'registryPassword']]) {
                buildAndPushImage(imageTag)
            }
        }
    }
}

def validateAllK8sConfigs(String imageTag) {
    stage('Validate K8S configs Dev') {
        currentStage = 'Validate K8S configs Dev'
        validateK8SConfigs(Environment.DEVELOPMENT, imageTag)
    }
    stage('Validate K8S configs Production') {
        currentStage = 'Validate K8S configs Production'
        validateK8SConfigs(Environment.PRODUCTION, imageTag)
    }
}

def runTests() {
    stage('Test') {
        currentStage = 'Test'
        container('maven') {
            withCredentials([usernamePassword(credentialsId: 'artifactory.lae', passwordVariable: 'ARTIFACTORY_PASSWORD', usernameVariable: 'ARTIFACTORY_USERNAME')]) {
                sh "echo ${ARTIFACTORY_PASSWORD} > artifactoryPw"
                sh "echo ${ARTIFACTORY_USERNAME} > artifactoryUser"
                sh "export ARTIFACTORY_PASSWORD=\$(cat artifactoryPw) && export ARTIFACTORY_USERNAME=\$(cat artifactoryUser)"
                sh "mvn clean verify -s jenkins-mvn-settings.xml -Dmaven.repo.local=${env.MAVEN_CACHE_REPO}"
                sh "rm artifactoryPw && rm artifactoryUser"
            }
            junit '**/target/surefire-reports/TEST-*.xml'
            publishHTML(target: [
                    allowMissing         : false,
                    alwaysLinkToLastBuild: false,
                    keepAll              : true,
                    reportDir            : 'target/coverage',
                    reportFiles          : 'index.html',
                    reportName           : 'Coverage Report',
                    reportTitles         : ''
            ])
        }
    }
}

///////// Utility methods /////////

def buildImageTag() {
    // Building the image tag
    String commitHash = sh(
            script: 'git rev-parse --short HEAD',
            returnStdout: true
    ).trim()
    echo "Image tag: ${commitHash}"
    return "${commitHash}"
}

def kubeSubst(placeholder, value, file) {
    sh "sed -i \"s|${placeholder}|${value}|\" ${file}"
}

def setupKubeConfig(Environment environment) {
    sh "setup-kubeconfig.sh --cluster-name ${environment.kubernetesCluster} --namespace ${environment.kubernetesNamespace}"
}

def buildAndPushImage(imageTag) {
    docker.withRegistry("https://" + "${KubeConfig.registryUrl}", "${KubeConfig.registryUrl}") {
        def dockerImage = docker.build("${KubeConfig.registryUrl}/${KubeConfig.registryRepository}:${imageTag}", " --pull .")

        retry(3) {
            dockerImage.push()
        }
    }
}

def deploy(Environment environment, String imageTag) {
    container('kubectl') {
        setupKubeConfig(environment)

        def fileDirectory = environment.fileDirectory
        def kubernetesNamespace = environment.kubernetesNamespace

        String secretsManifest = "deployment/${fileDirectory}/init/secret-provider-class.yaml"
        bash("Update secrets", "kubectl apply -f ${secretsManifest} -n $kubernetesNamespace")

        substituteTagInManifests(environment, imageTag)
        sh "kubectl apply -f deployment/${fileDirectory}/base-app"
        sh "kubectl rollout status deployment ${KubeConfig.kubernetesService} --namespace ${kubernetesNamespace}"
    }
}

void bash(String label, String command) {
    sh(label: label, script: command)
}

def validateK8SConfigs(Environment environment, String imageTag) {
    container('kubectl') {
        setupKubeConfig(environment)

        def fileDirectory = environment.fileDirectory
        def kubernetesNamespace = environment.kubernetesNamespace
        def envShortName = environment.shortName

        substituteTagInManifests(environment, imageTag)

        bash("validate ${envShortName} K8S Configs from init dir",
                "kubectl apply --validate=true --dry-run=client -f deployment/${fileDirectory}/init -n $kubernetesNamespace")
        bash("validate ${envShortName} K8S Configs from base-app dir",
                "kubectl apply --validate=true --dry-run=client -f deployment/${fileDirectory}/base-app -n $kubernetesNamespace")
    }
}

def substituteTagInManifests(Environment environment, String imageTag){
    kubeSubst("IMAGE_TAG", imageTag, "deployment/${environment.fileDirectory}/base-app/deployment.yaml")
}

def notifySuccessfulDeploy(Environment environment) {
    notifyOnMsTeams(
            "Build [**${currentBuild.displayName}**](${env.BUILD_URL}) for **${NotificationProperties.serviceName} ${env.TAG_NAME}** successfully deployed to ${environment.shortName} 🍺",
            'Success'
    )
}

def notifyFailedBuild(Throwable e) {
    // to display the message in red, mark the build status as 'FAILURE' before sending the message (https://github.com/jenkinsci/office-365-connector-plugin/issues/366)
    currentBuild.result = 'FAILURE'
    notifyOnMsTeams(
            "Build [**${currentBuild.displayName}**](${env.BUILD_URL}) failed for **${NotificationProperties.serviceName} ${env.TAG_NAME}** at stage **${currentStage}** 🙀 \n${e.toString()}",
            'Failure'
    )
}

def notifyOnMsTeams(String msTeamsMessage, String msTeamsStatus) {
    withCredentials([string(credentialsId: 'msteams.lae', variable: 'msTeamsWebhookUrl')]) {
        office365ConnectorSend webhookUrl: msTeamsWebhookUrl,
            message: msTeamsMessage,
            status: msTeamsStatus,
            adaptiveCards: true
    }
}
