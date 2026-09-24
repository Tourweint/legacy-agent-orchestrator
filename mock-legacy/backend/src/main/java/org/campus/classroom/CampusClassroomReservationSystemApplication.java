package org.campus.classroom;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.scheduling.annotation.EnableScheduling;


@SpringBootApplication
//@ComponentScan({"org.campus.classroom.controller", "org.campus.classroom.service", "org.campus.classroom.utils", "org.campus.classroom.security","org.campus.classroom.exception"})
@MapperScan("org.campus.classroom.mapper")
@EnableScheduling
public class CampusClassroomReservationSystemApplication {
    public static void main(String[] args) {
        SpringApplication.run(CampusClassroomReservationSystemApplication.class, args);
    }
}
