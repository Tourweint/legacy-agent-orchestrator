package org.campus.classroom.aop;

import lombok.extern.slf4j.Slf4j;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.stereotype.Component;


@Slf4j
@Aspect
@Component
public class ControllerAspect{
//    @Pointcut("execution(* org.campus.classroom.controller.*.*(..))")
//    public void controllerLayer() {}
//
//    @Before("controllerLayer()")
//    public void before(JoinPoint joinPoint) {
//        Object[] args = joinPoint.getArgs();
////        System.out.println(Arrays.toString(args));
//    }
//
//    @AfterThrowing(pointcut = "controllerLayer()", throwing = "exception")
//    public void AfterThrowing(JoinPoint joinPoint, Throwable exception) {
//        // ex 参数：必须与注解里的 throwing 属性名一致
//        // 它能捕捉到方法抛出的具体异常信息（如：余额不足异常）
//        System.err.println("【异常通知】"+joinPoint.getSignature().getName()+"方法执行出错了，异常原因：" + exception.getMessage());
//    }
//
//    public static void validLocalDateTime(String localDateTimeStr) {
//        try {
//            LocalDateTime.parse(localDateTimeStr, DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
//        } catch (Exception e) {
//            log.error(e.getMessage());
//            throw new IllegalArgumentException("时间格式错误");
//        }
//    }
}
