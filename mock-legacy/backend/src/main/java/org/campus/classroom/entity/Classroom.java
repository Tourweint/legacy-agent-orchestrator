package org.campus.classroom.entity;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class Classroom {
    private Long id;
    private String roomNumber;
    private String building;
    private Integer seatRows;
    private Integer seatCols;
    private String status;
    private String remark;
    private LocalDateTime createTime;
    private LocalDateTime updateTime;
}