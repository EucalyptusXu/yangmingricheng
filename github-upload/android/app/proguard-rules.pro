# 保持 JS 接口方法（被 @JavascriptInterface 标注，但混淆器看不到调用点）
-keepclassmembers class com.yangming.schedule.MainActivity$Bridge {
    public *;
}
-keepattributes JavascriptInterface
-keepattributes *Annotation*
