plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.yangming.schedule"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.yangming.schedule"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
    }

    // 有 keystore 才建签名配置。
    // 注意：别在配置阶段按名字去取 AGP 内置的 debug 签名配置 —— 它是懒创建的，
    // 取早了会抛 UnknownDomainObjectException，而且是在 configuration 阶段抛，
    // 连 assembleDebug 都跑不起来。宁可让 release 产出未签名包。
    val ymKeystore = rootProject.file("keystore/ym.jks")
    signingConfigs {
        if (ymKeystore.exists()) {
            create("release") {
                storeFile = ymKeystore
                storePassword = (project.findProperty("YM_STORE_PASSWORD") as String?) ?: "yangming"
                keyAlias = (project.findProperty("YM_KEY_ALIAS") as String?) ?: "yangming"
                keyPassword = (project.findProperty("YM_KEY_PASSWORD") as String?) ?: "yangming"
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // 没有 keystore 就不指定签名 —— 让 release 产出未签名包，而不是让配置阶段失败
            if (ymKeystore.exists()) signingConfig = signingConfigs.getByName("release")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        buildConfig = true
    }
    packaging {
        resources.excludes += setOf("META-INF/*.kotlin_module")
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("androidx.activity:activity-ktx:1.8.2")
}
